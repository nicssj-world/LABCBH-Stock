-- A browser can preview the next sequence, but the database owns the value
-- written to a contract PR so concurrent submissions cannot duplicate it.
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
  parsed_contract_id integer;
  parsed_method_details jsonb;
  next_sequence integer;
  next_purchase_sequence integer;
  line jsonb;
  line_index integer := 0;
  snapshot_on_hand numeric(15,3);
  snapshot_usage numeric(15,3);
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

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'purchase request must have at least one line';
  end if;

  parsed_fiscal_year := (p_request ->> 'fiscalYear')::integer;
  parsed_method := p_request -> 'method' ->> 'kind';
  parsed_method_details := (p_request -> 'method') - 'kind';

  if parsed_method is null then
    raise exception using errcode = '22023', message = 'purchase method is required';
  end if;

  -- This existing fiscal-year lock also serializes contract sequence assignment.
  perform pg_advisory_xact_lock(hashtext('labcbh_purchase_request_sequence'), parsed_fiscal_year);

  if parsed_method = 'contract' then
    parsed_contract_id := (parsed_method_details ->> 'contractId')::integer;
    if parsed_contract_id is null or parsed_contract_id <= 0 then
      raise exception using errcode = '22023', message = 'contract is required';
    end if;

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

    select coalesce(balance.on_hand, 0)
    into snapshot_on_hand
    from public.inventory_item_balances balance
    where balance.inventory_item_id = (line ->> 'inventoryItemId')::uuid;

    select coalesce(avg(issues.issued_quantity), 0)
    into snapshot_usage
    from public.inventory_item_monthly_issues issues
    where issues.inventory_item_id = (line ->> 'inventoryItemId')::uuid
      and issues.issue_month >= (date_trunc('month', current_date) - interval '3 months')::date
      and issues.issue_month < date_trunc('month', current_date)::date;

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
      nullif(line ->> 'contractItemId', '')::uuid,
      coalesce(snapshot_usage, 0),
      coalesce(snapshot_on_hand, 0),
      (line ->> 'requestedQuantity')::numeric,
      btrim(line ->> 'unit'),
      (line ->> 'unitPrice')::numeric
    );
  end loop;

  return created_request;
end
$function$;

revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from public;
revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from anon;
revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from authenticated;
grant execute on function public.create_purchase_request(uuid, jsonb, jsonb) to service_role;
