-- 20260820013745_pr_manual_catalog_items.sql taught create_purchase_request to
-- resolve or create the catalogue row for a manually-entered line, but left
-- three gaps behind. This migration closes all three, in order of severity:
--
-- 1. A contract-linked line's unit was always taken from client input, never
--    from contract_items.unit — unlike unit_price, which was already resolved
--    from the contract and never trusted from the client. That unprotected
--    unit becomes contract_item_allocations.quantity verbatim at confirmation
--    (see confirm_purchase_request in 20260803150000_pr_lease_origination.sql),
--    so a mismatched unit drew down the contract's real remaining balance by
--    the wrong amount, not just a mislabelled line.
-- 2. inventory_items_ls_code_normalized_key (from
--    20260729181206_lab_stock_inventory_ledger.sql) is not a partial index, so
--    it correctly blocks a duplicate LS code even when the existing row is
--    inactive — but the recovery read afterward filtered on is_active, so the
--    request failed with the generic 'could not resolve the new inventory
--    item' instead of naming the real, actionable cause.
-- 3. unitPrice and requestedQuantity on a non-contract line, and fiscalYear/
--    department/headName/requestedDate on the request itself, were cast or
--    used without validation. The table constraints they eventually hit do
--    prevent bad data from being committed, but the request failed on a raw
--    Postgres error instead of one of this function's own clean messages.
begin;

create or replace function public.create_purchase_request(
  p_actor_id uuid,
  p_request jsonb,
  p_items jsonb
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_request public.purchase_requests%rowtype;
  parsed_fiscal_year integer;
  parsed_method text;
  parsed_contract_id bigint;
  parsed_method_details jsonb;
  next_sequence integer;
  next_purchase_sequence integer;
  line jsonb;
  line_index integer := 0;
  snapshot_on_hand numeric(15,3);
  snapshot_usage numeric(15,3);
  submitted_inventory_item_id uuid;
  resolved_inventory_item_id uuid;
  resolved_contract_item_id uuid;
  resolved_contract_id bigint;
  resolved_contract_ls_code text;
  resolved_unit_price numeric(15,2);
  resolved_unit text;
  resolved_requested_quantity numeric(15,3);
  resolved_item_is_active boolean;
  manual_ls_code text;
  manual_name text;
  manual_unit text;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = '22023', message = 'purchase request payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_request) field_name
    where field_name not in ('fiscalYear', 'department', 'headName', 'requestedDate', 'note', 'method')
  ) then
    raise exception using errcode = '22023', message = 'unexpected purchase request field';
  end if;

  -- Each of these previously reached a raw Postgres cast or not-null error
  -- (via the advisory lock silently no-op'ing on a null fiscal year, or the
  -- table's own check/not-null constraints) rather than one of this
  -- function's own messages. Checked up front, before any of them are used.
  if p_request ->> 'fiscalYear' !~ '^[0-9]+$' then
    raise exception using errcode = '22023', message = 'fiscal year is required';
  end if;

  if nullif(btrim(coalesce(p_request ->> 'department', '')), '') is null then
    raise exception using errcode = '22023', message = 'department is required';
  end if;

  if nullif(btrim(coalesce(p_request ->> 'headName', '')), '') is null then
    raise exception using errcode = '22023', message = 'requester head name is required';
  end if;

  if p_request ->> 'requestedDate' is null then
    raise exception using errcode = '22023', message = 'requested date is required';
  end if;

  if jsonb_typeof(p_request -> 'method') <> 'object' then
    raise exception using errcode = '22023', message = 'purchase method is required';
  end if;

  parsed_fiscal_year := (p_request ->> 'fiscalYear')::integer;
  parsed_method := p_request -> 'method' ->> 'kind';
  parsed_method_details := (p_request -> 'method') - 'kind';

  if parsed_method is null or parsed_method not in (
    'annual_plan', 'contract', 'awaiting_contract', 'off_plan',
    'specific_contract', 'e_bidding', 'equipment_lease'
  ) then
    raise exception using errcode = '22023', message = 'invalid purchase method';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'purchase request items must be an array';
  end if;

  if jsonb_array_length(p_items) = 0 and parsed_method <> 'equipment_lease' then
    raise exception using errcode = '22023', message = 'purchase request must have at least one line';
  end if;

  if jsonb_array_length(p_items) > 0 and parsed_method = 'equipment_lease' then
    raise exception using errcode = '22023', message = 'a purchase request opening an equipment lease cannot have items';
  end if;

  perform pg_advisory_xact_lock(hashtext('labcbh_purchase_request_sequence'), parsed_fiscal_year);

  if parsed_method in ('contract', 'awaiting_contract') then
    if coalesce(parsed_method_details ->> 'contractId', '') !~ '^[1-9][0-9]*$' then
      raise exception using errcode = '22023', message = 'contract is required';
    end if;
    parsed_contract_id := (parsed_method_details ->> 'contractId')::bigint;

    perform public.validate_purchase_request_contract(
      parsed_contract_id,
      p_request ->> 'department',
      parsed_method = 'contract'
    );
  end if;

  if parsed_method = 'contract' then
    select coalesce(max((request.method_details ->> 'purchaseSequence')::integer), 0) + 1
    into next_purchase_sequence
    from public.purchase_requests request
    where request.purchase_method = 'contract'
      and request.status not in ('cancelled', 'reversed')
      and request.method_details ->> 'contractId' = parsed_contract_id::text;

    parsed_method_details := jsonb_set(
      parsed_method_details,
      '{purchaseSequence}',
      to_jsonb(next_purchase_sequence),
      true
    );
  end if;

  select coalesce(max(request.sequence_number), 0) + 1
  into next_sequence
  from public.purchase_requests request
  where request.fiscal_year = parsed_fiscal_year;

  insert into public.purchase_requests (
    fiscal_year,
    sequence_number,
    document_number,
    requester_id,
    department,
    head_name,
    requested_date,
    purchase_method,
    method_details,
    status,
    note,
    created_by,
    updated_by
  )
  values (
    parsed_fiscal_year,
    next_sequence,
    'PR-' || parsed_fiscal_year || '-' || lpad(next_sequence::text, 4, '0'),
    p_actor_id,
    btrim(p_request ->> 'department'),
    btrim(p_request ->> 'headName'),
    (p_request ->> 'requestedDate')::date,
    parsed_method,
    parsed_method_details,
    'pending',
    nullif(btrim(coalesce(p_request ->> 'note', '')), ''),
    p_actor_id,
    p_actor_id
  )
  returning * into created_request;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_index := line_index + 1;
    submitted_inventory_item_id := nullif(btrim(coalesce(line ->> 'inventoryItemId', '')), '')::uuid;
    resolved_inventory_item_id := submitted_inventory_item_id;
    resolved_contract_item_id := nullif(btrim(coalesce(line ->> 'contractItemId', '')), '')::uuid;

    begin
      resolved_requested_quantity := (line ->> 'requestedQuantity')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'purchase request line requires a numeric requested quantity';
    end;

    if resolved_requested_quantity is null or resolved_requested_quantity <= 0 then
      raise exception using errcode = '22023', message = 'purchase request line requires a requested quantity greater than zero';
    end if;

    if parsed_method = 'contract' and resolved_contract_item_id is null then
      raise exception using errcode = '22023', message = 'contract purchase request lines require a contract item';
    elsif parsed_method <> 'contract' and resolved_contract_item_id is not null then
      raise exception using errcode = '22023', message = 'only a contract purchase request may carry a contract item';
    end if;

    if resolved_contract_item_id is not null then
      if resolved_inventory_item_id is null then
        raise exception using errcode = '22023', message = 'contract purchase request lines must select an inventory item';
      end if;

      -- unit is resolved from the contract line, same as unit_price: a
      -- contract-linked line must never let the client choose the unit that
      -- ends up drawing down the contract's remaining balance.
      select contract_item.unit_price, contract_item.contract_id, contract_item.ls_code, contract_item.unit
      into resolved_unit_price, resolved_contract_id, resolved_contract_ls_code, resolved_unit
      from public.contract_items contract_item
      where contract_item.id = resolved_contract_item_id;

      if not found then
        raise exception using errcode = '23503', message = 'contract item not found';
      end if;

      if resolved_contract_id is distinct from parsed_contract_id then
        raise exception using errcode = '23503', message = 'contract item belongs to a different contract';
      end if;

      if not exists (
        select 1
        from public.inventory_items inventory_item
        where inventory_item.id = resolved_inventory_item_id
          and upper(regexp_replace(inventory_item.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
              upper(regexp_replace(resolved_contract_ls_code, '[^a-zA-Z0-9]', '', 'g'))
      ) then
        raise exception using errcode = '23514', message = 'inventory item does not match the contract item';
      end if;
    else
      begin
        resolved_unit_price := (line ->> 'unitPrice')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception using errcode = '22023', message = 'purchase request line requires a numeric unit price';
      end;

      if resolved_unit_price is null or resolved_unit_price < 0 then
        raise exception using errcode = '22023', message = 'purchase request line requires a unit price of zero or more';
      end if;

      resolved_unit := btrim(line ->> 'unit');

      if resolved_inventory_item_id is null then
        manual_ls_code := nullif(btrim(coalesce(line ->> 'lsCode', '')), '');
        manual_name := nullif(btrim(coalesce(line ->> 'name', '')), '');
        manual_unit := nullif(btrim(coalesce(line ->> 'unit', '')), '');

        if manual_ls_code is null then
          raise exception using errcode = '22023', message = 'new purchase request lines require an LS code';
        end if;
        if manual_name is null then
          raise exception using errcode = '22023', message = 'new purchase request lines require a name';
        end if;
        if manual_unit is null then
          raise exception using errcode = '22023', message = 'new purchase request lines require a unit';
        end if;

        -- The normalized LS-code index is the identity boundary. If another
        -- request created the same item concurrently, reuse that committed row
        -- instead of producing a duplicate or a half-created PR.
        insert into public.inventory_items (
          ls_code,
          name,
          base_unit,
          responsible_department,
          default_unit_price,
          minimum_stock_months,
          minimum_stock_override,
          is_active,
          note,
          source_metadata,
          created_by,
          updated_by
        )
        values (
          manual_ls_code,
          manual_name,
          manual_unit,
          nullif(btrim(coalesce(p_request ->> 'department', '')), ''),
          resolved_unit_price,
          1.5,
          null,
          true,
          null,
          jsonb_build_object(
            'source', 'purchase_request',
            'purchase_request_id', created_request.id,
            'document_number', created_request.document_number
          ),
          p_actor_id,
          p_actor_id
        )
        on conflict do nothing;

        -- Not filtered by is_active: the unique index isn't either, so a
        -- prior inactive row with the same LS code still absorbs this insert
        -- via ON CONFLICT DO NOTHING. Reading it back without the filter is
        -- what lets the check below name that real cause instead of the
        -- generic 'could not resolve' message.
        select inventory_item.id, inventory_item.is_active
        into resolved_inventory_item_id, resolved_item_is_active
        from public.inventory_items inventory_item
        where upper(regexp_replace(inventory_item.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
              upper(regexp_replace(manual_ls_code, '[^a-zA-Z0-9]', '', 'g'));

        if not found then
          raise exception using errcode = '23514', message = 'could not resolve the new inventory item';
        end if;

        if not resolved_item_is_active then
          raise exception using
            errcode = '55000',
            message = 'an inactive inventory item already uses this LS code; reactivate it instead of adding it as new';
        end if;
      end if;
    end if;

    select coalesce(balance.on_hand, 0)
    into snapshot_on_hand
    from public.inventory_item_balances balance
    where balance.inventory_item_id = resolved_inventory_item_id;

    select coalesce(avg(issues.issued_quantity), 0)
    into snapshot_usage
    from public.inventory_item_monthly_issues issues
    where issues.inventory_item_id = resolved_inventory_item_id
      and issues.issue_month >= (date_trunc('month', public.lab_stock_today()::timestamp) - interval '3 months')::date
      and issues.issue_month < date_trunc('month', public.lab_stock_today()::timestamp)::date;

    insert into public.purchase_request_items (
      purchase_request_id,
      line_number,
      inventory_item_id,
      contract_item_id,
      monthly_usage_snapshot,
      on_hand_snapshot,
      requested_quantity,
      unit,
      unit_price
    )
    values (
      created_request.id,
      line_index,
      resolved_inventory_item_id,
      resolved_contract_item_id,
      coalesce(snapshot_usage, 0),
      coalesce(snapshot_on_hand, 0),
      resolved_requested_quantity,
      resolved_unit,
      resolved_unit_price
    );
  end loop;

  return created_request;
end
$function$;

revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_purchase_request(uuid, jsonb, jsonb) to service_role;

commit;
