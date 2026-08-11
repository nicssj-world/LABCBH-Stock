begin;

-- All business-date decisions in the stock application use the Bangkok
-- calendar, regardless of the database session timezone.
create or replace function public.lab_stock_today()
returns date
language sql
stable
security invoker
set search_path = ''
as $function$
  select (now() at time zone 'Asia/Bangkok')::date
$function$;

revoke execute on function public.lab_stock_today() from public, anon, authenticated;
grant execute on function public.lab_stock_today() to service_role;

-- Validate the contract reference while locking it. This is shared by PR
-- creation, line-item integrity triggers, and allocation validation so a stale
-- browser cannot draw down a cancelled, archived, expired, or wrong-department
-- contract.
create or replace function public.validate_purchase_request_contract(
  p_contract_id bigint,
  p_department text,
  p_requires_drawdown boolean
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract public.contracts%rowtype;
begin
  if p_contract_id is null or p_contract_id <= 0 then
    raise exception using errcode = '22023', message = 'contract is required';
  end if;

  select *
  into target_contract
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'contract not found';
  end if;

  if coalesce(target_contract.is_archived, false) then
    raise exception using errcode = '55000', message = 'archived contract cannot be used by a purchase request';
  end if;

  if target_contract.department is distinct from nullif(btrim(p_department), '') then
    raise exception using errcode = '42501', message = 'contract belongs to a different department';
  end if;

  if p_requires_drawdown then
    if target_contract.status is distinct from 'active'
       or target_contract.procurement_stage is distinct from 'contract_started'
       or target_contract.contract_type is not distinct from 'equipment_lease'
       or (target_contract.end_date is not null and target_contract.end_date < public.lab_stock_today()) then
      raise exception using errcode = '55000', message = 'contract is not active for purchase drawdown';
    end if;
  elsif target_contract.status is distinct from 'pending'
     or target_contract.procurement_stage is not distinct from 'contract_started' then
    raise exception using errcode = '55000', message = 'contract is not awaiting procurement';
  end if;

  return target_contract;
end
$function$;

revoke execute on function public.validate_purchase_request_contract(bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.validate_purchase_request_contract(bigint, text, boolean) to service_role;

-- A contract PR line must point to a line of the selected contract and to the
-- matching catalogue item. Other PR methods must never carry a contract item,
-- because confirmation would otherwise create an allocation against it.
create or replace function public.validate_purchase_request_item_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.purchase_requests%rowtype;
  target_contract public.contracts%rowtype;
  contract_item_row public.contract_items%rowtype;
  inventory_ls_code text;
  requested_contract_id bigint;
begin
  select *
  into request_row
  from public.purchase_requests request
  where request.id = new.purchase_request_id;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if request_row.purchase_method is distinct from 'contract' then
    if new.contract_item_id is not null then
      raise exception using errcode = '22023', message = 'only a contract purchase request may carry a contract item';
    end if;
    return new;
  end if;

  if new.contract_item_id is null then
    raise exception using errcode = '22023', message = 'contract purchase request lines require a contract item';
  end if;

  if coalesce(request_row.method_details ->> 'contractId', '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'contract is required';
  end if;
  requested_contract_id := (request_row.method_details ->> 'contractId')::bigint;

  select *
  into target_contract
  from public.validate_purchase_request_contract(
    requested_contract_id,
    request_row.department,
    true
  );

  select *
  into contract_item_row
  from public.contract_items contract_item
  where contract_item.id = new.contract_item_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'contract item not found';
  end if;

  if contract_item_row.contract_id is distinct from target_contract.id then
    raise exception using errcode = '23503', message = 'contract item belongs to a different contract';
  end if;

  select inventory_item.ls_code
  into inventory_ls_code
  from public.inventory_items inventory_item
  where inventory_item.id = new.inventory_item_id;

  if not found then
    raise exception using errcode = '23503', message = 'inventory item not found';
  end if;

  if upper(regexp_replace(contract_item_row.ls_code, '[^a-zA-Z0-9]', '', 'g'))
     is distinct from upper(regexp_replace(inventory_ls_code, '[^a-zA-Z0-9]', '', 'g')) then
    raise exception using errcode = '23514', message = 'inventory item does not match the contract item';
  end if;

  return new;
end
$function$;

revoke execute on function public.validate_purchase_request_item_contract() from public, anon, authenticated;
drop trigger if exists purchase_request_items_contract_integrity on public.purchase_request_items;
create trigger purchase_request_items_contract_integrity
before insert or update on public.purchase_request_items
for each row execute function public.validate_purchase_request_item_contract();

-- Reapply the latest price-lock function with the same server-side snapshots,
-- plus contract status/reference validation before any line is inserted.
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
  resolved_contract_item_id uuid;
  resolved_contract_id bigint;
  resolved_contract_ls_code text;
  resolved_unit_price numeric(15,2);
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
    resolved_contract_item_id := nullif(line ->> 'contractItemId', '')::uuid;

    if parsed_method = 'contract' and resolved_contract_item_id is null then
      raise exception using errcode = '22023', message = 'contract purchase request lines require a contract item';
    elsif parsed_method <> 'contract' and resolved_contract_item_id is not null then
      raise exception using errcode = '22023', message = 'only a contract purchase request may carry a contract item';
    end if;

    if resolved_contract_item_id is not null then
      select contract_item.unit_price, contract_item.contract_id, contract_item.ls_code
      into resolved_unit_price, resolved_contract_id, resolved_contract_ls_code
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
        where inventory_item.id = (line ->> 'inventoryItemId')::uuid
          and upper(regexp_replace(inventory_item.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
              upper(regexp_replace(resolved_contract_ls_code, '[^a-zA-Z0-9]', '', 'g'))
      ) then
        raise exception using errcode = '23514', message = 'inventory item does not match the contract item';
      end if;
    else
      resolved_unit_price := (line ->> 'unitPrice')::numeric;
    end if;

    select coalesce(balance.on_hand, 0)
    into snapshot_on_hand
    from public.inventory_item_balances balance
    where balance.inventory_item_id = (line ->> 'inventoryItemId')::uuid;

    select coalesce(avg(issues.issued_quantity), 0)
    into snapshot_usage
    from public.inventory_item_monthly_issues issues
    where issues.inventory_item_id = (line ->> 'inventoryItemId')::uuid
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
      (line ->> 'inventoryItemId')::uuid,
      resolved_contract_item_id,
      coalesce(snapshot_usage, 0),
      coalesce(snapshot_on_hand, 0),
      (line ->> 'requestedQuantity')::numeric,
      btrim(line ->> 'unit'),
      resolved_unit_price
    );
  end loop;

  return created_request;
end
$function$;

revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_purchase_request(uuid, jsonb, jsonb) to service_role;

-- Allocations are the final write boundary. Recheck the PR, selected contract,
-- contract item, and catalogue identity here so old or manually crafted PR rows
-- cannot bypass the same integrity rules at confirmation time.
create or replace function public.validate_contract_item_allocation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  contracted_quantity numeric(15,3);
  committed_quantity numeric(15,3);
  original_allocation public.contract_item_allocations%rowtype;
  locked_request public.purchase_requests%rowtype;
  request_item public.purchase_request_items%rowtype;
  locked_contract public.contracts%rowtype;
  locked_item public.contract_items%rowtype;
  inventory_ls_code text;
  expected_contract_id bigint;
begin
  if new.allocation_kind = 'purchase_request' then
    select *
    into request_item
    from public.purchase_request_items item
    where item.id = new.purchase_request_item_id;

    if not found then
      raise exception using errcode = '23503', message = 'purchase request item not found';
    end if;

    select *
    into locked_request
    from public.purchase_requests request
    where request.id = request_item.purchase_request_id
    for update;

    if not found or locked_request.purchase_method is distinct from 'contract' then
      raise exception using errcode = '23514', message = 'allocation must reference a contract purchase request';
    end if;

    if locked_request.status is distinct from 'pending' then
      raise exception using errcode = '55000', message = 'only a pending purchase request can be allocated';
    end if;

    if coalesce(locked_request.method_details ->> 'contractId', '') !~ '^[1-9][0-9]*$' then
      raise exception using errcode = '22023', message = 'contract is required';
    end if;
    expected_contract_id := (locked_request.method_details ->> 'contractId')::bigint;

    select *
    into locked_contract
    from public.validate_purchase_request_contract(
      expected_contract_id,
      locked_request.department,
      true
    );

    select *
    into locked_item
    from public.contract_items item
    where item.id = new.contract_item_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'contract item not found';
    end if;

    if locked_item.contract_id is distinct from locked_contract.id
       or request_item.contract_item_id is distinct from new.contract_item_id then
      raise exception using errcode = '23514', message = 'allocation contract item does not match the purchase request';
    end if;

    select inventory_item.ls_code
    into inventory_ls_code
    from public.inventory_items inventory_item
    where inventory_item.id = request_item.inventory_item_id;

    if not found
       or upper(regexp_replace(inventory_ls_code, '[^a-zA-Z0-9]', '', 'g')) is distinct from
          upper(regexp_replace(locked_item.ls_code, '[^a-zA-Z0-9]', '', 'g')) then
      raise exception using errcode = '23514', message = 'allocation inventory item does not match the contract item';
    end if;

    contracted_quantity := locked_item.quantity;
  else
    select item.quantity
    into contracted_quantity
    from public.contract_items item
    where item.id = new.contract_item_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'contract item not found';
    end if;
  end if;

  select coalesce(sum(allocation.quantity), 0)
  into committed_quantity
  from public.contract_item_allocations allocation
  where allocation.contract_item_id = new.contract_item_id;

  if new.allocation_kind = 'reversal' then
    select allocation.*
    into original_allocation
    from public.contract_item_allocations allocation
    where allocation.id = new.reference_allocation_id
    for share;

    if not found
      or original_allocation.allocation_kind = 'reversal'
      or original_allocation.quantity <= 0
      or original_allocation.contract_item_id <> new.contract_item_id
      or new.quantity <> -original_allocation.quantity
    then
      raise exception using
        errcode = '23514',
        message = 'reversal must exactly negate its original allocation for the same contract item';
    end if;
  end if;

  if committed_quantity + new.quantity > contracted_quantity then
    raise exception using errcode = '23514', message = 'allocation exceeds contracted quantity';
  end if;

  if committed_quantity + new.quantity < 0 then
    raise exception using errcode = '23514', message = 'allocation would make committed quantity negative';
  end if;

  return new;
end
$function$;

revoke execute on function public.validate_contract_item_allocation() from public, anon, authenticated;

commit;
