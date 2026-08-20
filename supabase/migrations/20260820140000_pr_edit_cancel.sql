-- Allow requesters to correct a PR while it is still pending, and to remove a
-- mistaken request without deleting its audit trail. Confirmed PRs remain
-- immutable here: their contract allocations (or originated contracts) must
-- be reversed through the existing audited workflow instead.
begin;

create or replace function public.update_purchase_request(
  p_pr_id uuid,
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
  locked_request public.purchase_requests%rowtype;
  updated_request public.purchase_requests%rowtype;
  parsed_fiscal_year integer;
  parsed_method text;
  parsed_contract_id bigint;
  parsed_method_details jsonb;
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

  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'purchase request not found';
  end if;

  if locked_request.status <> 'pending' then
    raise exception using
      errcode = '55000',
      message = 'only a pending purchase request can be edited';
  end if;

  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = '22023', message = 'purchase request payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_request) field_name
    where field_name not in ('fiscalYear', 'department', 'headName', 'requestedDate', 'note', 'method')
  ) then
    raise exception using errcode = '22023', message = 'unexpected purchase request field';
  end if;

  if coalesce(p_request ->> 'fiscalYear', '') !~ '^[0-9]+$' then
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

  parsed_fiscal_year := (p_request ->> 'fiscalYear')::integer;
  if parsed_fiscal_year <> locked_request.fiscal_year then
    raise exception using
      errcode = '22023',
      message = 'แก้วันที่ข้ามปีงบประมาณไม่ได้ กรุณายกเลิกแล้วสร้างใบ PR ใหม่';
  end if;

  if jsonb_typeof(p_request -> 'method') <> 'object' then
    raise exception using errcode = '22023', message = 'purchase method is required';
  end if;

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
    -- Keep the existing sequence when the same pending PR stays on the same
    -- contract. Switching contracts receives a fresh sequence under the same
    -- advisory lock used by creation.
    if locked_request.purchase_method = 'contract'
       and locked_request.method_details ->> 'contractId' = parsed_contract_id::text
       and coalesce(locked_request.method_details ->> 'purchaseSequence', '') ~ '^[1-9][0-9]*$' then
      next_purchase_sequence := (locked_request.method_details ->> 'purchaseSequence')::integer;
    else
      select coalesce(max(
        case
          when request.method_details ->> 'purchaseSequence' ~ '^[1-9][0-9]*$'
            then (request.method_details ->> 'purchaseSequence')::integer
          else 0
        end
      ), 0) + 1
      into next_purchase_sequence
      from public.purchase_requests request
      where request.purchase_method = 'contract'
        and request.status not in ('cancelled', 'reversed')
        and request.id <> locked_request.id
        and request.method_details ->> 'contractId' = parsed_contract_id::text;
    end if;

    parsed_method_details := jsonb_set(
      parsed_method_details,
      '{purchaseSequence}',
      to_jsonb(next_purchase_sequence),
      true
    );
  end if;

  if exists (
    select 1
    from public.contract_item_allocations allocation
    join public.purchase_request_items item on item.id = allocation.purchase_request_item_id
    where item.purchase_request_id = locked_request.id
  ) then
    raise exception using
      errcode = '55000',
      message = 'purchase request already has a contract allocation';
  end if;

  update public.purchase_requests
  set department = btrim(p_request ->> 'department'),
      requested_date = (p_request ->> 'requestedDate')::date,
      purchase_method = parsed_method,
      method_details = parsed_method_details,
      note = nullif(btrim(coalesce(p_request ->> 'note', '')), ''),
      updated_by = p_actor_id
  where id = locked_request.id
  returning * into updated_request;

  delete from public.purchase_request_items
  where purchase_request_id = locked_request.id;

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
            'purchase_request_id', updated_request.id,
            'document_number', updated_request.document_number
          ),
          p_actor_id,
          p_actor_id
        )
        on conflict do nothing;

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
      updated_request.id,
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

  return updated_request;
end
$function$;

revoke execute on function public.update_purchase_request(uuid, uuid, jsonb, jsonb) from public;
revoke execute on function public.update_purchase_request(uuid, uuid, jsonb, jsonb) from anon;
revoke execute on function public.update_purchase_request(uuid, uuid, jsonb, jsonb) from authenticated;
grant execute on function public.update_purchase_request(uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.cancel_purchase_request(
  p_pr_id uuid,
  p_actor_id uuid
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  cancelled_request public.purchase_requests%rowtype;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'purchase request not found';
  end if;

  if locked_request.status <> 'pending' then
    raise exception using
      errcode = '55000',
      message = 'only a pending purchase request can be cancelled';
  end if;

  update public.purchase_requests
  set status = 'cancelled',
      updated_by = p_actor_id
  where id = locked_request.id
  returning * into cancelled_request;

  return cancelled_request;
end
$function$;

revoke execute on function public.cancel_purchase_request(uuid, uuid) from public;
revoke execute on function public.cancel_purchase_request(uuid, uuid) from anon;
revoke execute on function public.cancel_purchase_request(uuid, uuid) from authenticated;
grant execute on function public.cancel_purchase_request(uuid, uuid) to service_role;

commit;
