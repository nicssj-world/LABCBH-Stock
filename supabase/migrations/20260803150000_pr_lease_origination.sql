-- Lets a purchase request originate an equipment-lease contract, the same way
-- "ทำสัญญาเจาะจง"/"E-Bidding" already originate a specific/e-bidding contract.
-- A lease has no line items (it is billed monthly in baht against a ceiling,
-- per contractMode() in lib/contracts/budget.ts), so confirm_purchase_request
-- must build zero contract_items for it instead of aggregating reagent rows.
--
-- This also closes a standing gap: no path in this app has ever been able to
-- set a lease contract's ceiling (contracts.total) — create_contract's only
-- source for it was summing item lines, and a lease always has zero items, so
-- total was silently null forever. create_contract now accepts an explicit
-- 'total' key in its jsonb payload, allowed only when contractType is
-- 'equipment_lease'.
begin;

create or replace function public.create_contract(
  p_actor_id uuid,
  p_contract jsonb,
  p_items jsonb,
  p_effective_date date,
  p_contract_number text default null
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_contract public.contracts%rowtype;
  normalized_display_name text;
  normalized_vendor text;
  normalized_contract_number text;
  parsed_fiscal_year integer;
  parsed_contract_type text;
  parsed_department text;
  parsed_end_date date;
  parsed_total numeric(17,2);
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  if p_effective_date is null then
    raise exception using errcode = '22004', message = 'effective date is required';
  end if;

  if p_contract is null or jsonb_typeof(p_contract) <> 'object' then
    raise exception using errcode = '22023', message = 'contract payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_contract) field_name
    where field_name not in ('fiscalYear', 'contractType', 'department', 'displayName', 'vendor', 'endDate', 'total')
  ) then
    raise exception using errcode = '22023', message = 'unexpected contract field';
  end if;

  -- A ceiling only means something for a lease: every other type derives its
  -- total from summed line items, so a supplied 'total' would be silently
  -- meaningless (and worse, misleading) rather than simply unused.
  if p_contract ? 'total' and (p_contract ->> 'contractType') is distinct from 'equipment_lease' then
    raise exception using errcode = '22023', message = 'total may only be set for an equipment lease contract';
  end if;

  if not (p_contract ?& array['fiscalYear', 'contractType', 'department', 'displayName', 'vendor', 'endDate'])
    or jsonb_typeof(p_contract -> 'fiscalYear') is distinct from 'number'
    or mod((p_contract ->> 'fiscalYear')::numeric, 1) <> 0
    or jsonb_typeof(p_contract -> 'contractType') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'department') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'displayName') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'vendor') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'endDate') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'total') not in ('number', 'null')
  then
    raise exception using errcode = '22023', message = 'invalid contract metadata';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'contract items must be an array';
  end if;

  -- An equipment lease is billed in baht against a ceiling and holds no line
  -- items; requiring one made a lease impossible to create at all.
  if jsonb_array_length(p_items) = 0
     and (p_contract ->> 'contractType') is distinct from 'equipment_lease' then
    raise exception using errcode = '22023', message = 'contract requires at least one item';
  end if;

  if jsonb_array_length(p_items) > 0
     and (p_contract ->> 'contractType') = 'equipment_lease' then
    raise exception using errcode = '22023', message = 'an equipment lease contract cannot hold line items';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where jsonb_typeof(item) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(item) field_name
        where field_name not in ('lsCode', 'name', 'quantity', 'unit', 'unitPrice')
      )
  ) then
    raise exception using errcode = '22023', message = 'unexpected contract item field';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where jsonb_typeof(item -> 'lsCode') is distinct from 'string'
      or jsonb_typeof(item -> 'name') is distinct from 'string'
      or jsonb_typeof(item -> 'unit') is distinct from 'string'
      or nullif(btrim(item ->> 'lsCode'), '') is null
      or nullif(btrim(item ->> 'name'), '') is null
      or nullif(btrim(item ->> 'unit'), '') is null
      or jsonb_typeof(item -> 'quantity') is distinct from 'number'
      or (item ->> 'quantity')::numeric <= 0
      or jsonb_typeof(item -> 'unitPrice') is distinct from 'number'
      or (item ->> 'unitPrice')::numeric <= 0
  ) then
    raise exception using errcode = '22023', message = 'invalid contract item';
  end if;

  normalized_display_name := nullif(btrim(p_contract ->> 'displayName'), '');
  normalized_vendor := nullif(btrim(p_contract ->> 'vendor'), '');
  parsed_fiscal_year := (p_contract ->> 'fiscalYear')::integer;
  parsed_contract_type := p_contract ->> 'contractType';
  parsed_department := p_contract ->> 'department';
  parsed_end_date := nullif(p_contract ->> 'endDate', '')::date;

  if normalized_display_name is null then
    raise exception using errcode = '23502', message = 'display name is required';
  end if;

  if parsed_fiscal_year not between 2500 and 3000 then
    raise exception using errcode = '22023', message = 'invalid fiscal year';
  end if;

  if parsed_contract_type not in (
    'equipment_lease', 'e_bidding', 'annual_specific', 'specific',
    'off_plan', 'awaiting_equipment_lease', 'thai_red_cross'
  ) then
    raise exception using errcode = '22023', message = 'invalid contract type';
  end if;

  if parsed_department not in (
    'สำนักงานกลุ่มงานเทคนิคการแพทย์',
    'งานเคมีคลินิก',
    'งานโลหิตวิทยาคลินิก',
    'งานภูมิคุ้มกันวิทยาคลินิก',
    'งานจุลทรรศนศาสตร์คลินิก',
    'งานอณูชีววิทยา',
    'งานจุลชีววิทยา',
    'งานคลังเลือด',
    'งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ',
    'งานบริการผู้ป่วยนอก',
    'ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี',
    'คลังน้ำยาและวัสดุวิทยาศาสตร์',
    'POCT'
  ) then
    raise exception using errcode = '22023', message = 'invalid department';
  end if;

  -- A lease has no items to sum: its ceiling is whatever was supplied
  -- directly (possibly unset — a null ceiling is an unknown ceiling, not a
  -- zero one, per budgetSnapshot in lib/contracts/budget.ts).
  if parsed_contract_type = 'equipment_lease' then
    parsed_total := round(nullif(p_contract ->> 'total', '')::numeric, 2);
  else
    select round(sum(
      (item ->> 'quantity')::numeric * (item ->> 'unitPrice')::numeric
    ), 2)
    into parsed_total
    from jsonb_array_elements(p_items) item;
  end if;

  normalized_contract_number := nullif(btrim(p_contract_number), '');

  if normalized_contract_number is not null then
    -- The fast path fabricates no procurement history: it is restricted to
    -- admins only (narrower than assert_contract_editor_actor, which also
    -- lets head advance normal contracts stage by stage), mirroring how
    -- isAdministrator() derives 'admin' in lib/auth/access.ts.
    if not exists (
      select 1
      from public.profiles profile
      where profile.id = p_actor_id
        and profile.status = 'active'
        and profile.deleted_at is null
        and (
          profile.ephis_id = '9495'
          or exists (
            select 1
            from public.lab_stock_memberships membership
            where membership.profile_id = profile.id
              and membership.active
              and membership.role = 'admin'
          )
        )
    ) then
      raise exception using errcode = '42501', message = 'actor is not allowed to create an already-started contract';
    end if;

    if exists (
      select 1
      from public.contracts contract
      where contract.contract_number is not null
        and lower(btrim(contract.contract_number)) = lower(normalized_contract_number)
    ) then
      raise exception using errcode = '23505', message = 'contract number is already in use';
    end if;
  end if;

  insert into public.contracts (
    vendor,
    product,
    total,
    end_date,
    status,
    contract_number,
    fiscal_year,
    contract_type,
    department,
    procurement_stage,
    display_name,
    sent_to_procurement_date,
    start_date,
    contract_started_date,
    stage_updated_at,
    source_metadata
  ) values (
    normalized_vendor,
    normalized_display_name,
    parsed_total,
    parsed_end_date,
    case when normalized_contract_number is not null then 'active' else 'pending' end,
    normalized_contract_number,
    parsed_fiscal_year,
    parsed_contract_type,
    parsed_department,
    case when normalized_contract_number is not null then 'contract_started' else 'sent_to_procurement' end,
    normalized_display_name,
    case when normalized_contract_number is not null then null else p_effective_date end,
    case when normalized_contract_number is not null then p_effective_date else null end,
    case when normalized_contract_number is not null then p_effective_date else null end,
    now(),
    jsonb_build_object('source', 'labcbh_stock')
  )
  returning * into created_contract;

  insert into public.contract_items (
    contract_id,
    line_number,
    ls_code,
    name,
    quantity,
    unit,
    unit_price,
    created_by,
    updated_by,
    source_metadata
  )
  select
    created_contract.id,
    item_order::integer,
    btrim(item ->> 'lsCode'),
    btrim(item ->> 'name'),
    (item ->> 'quantity')::numeric,
    btrim(item ->> 'unit'),
    (item ->> 'unitPrice')::numeric,
    p_actor_id,
    p_actor_id,
    jsonb_build_object('source', 'labcbh_stock')
  from jsonb_array_elements(p_items) with ordinality as payload(item, item_order);

  insert into public.contract_stage_history (
    contract_id,
    from_stage,
    to_stage,
    effective_date,
    contract_number_snapshot,
    note,
    source,
    actor_id
  ) values (
    created_contract.id,
    null,
    case when normalized_contract_number is not null then 'contract_started' else 'sent_to_procurement' end,
    p_effective_date,
    normalized_contract_number,
    null,
    'labcbh_stock',
    p_actor_id
  );

  return created_contract;
end
$function$;

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

  parsed_fiscal_year := (p_request ->> 'fiscalYear')::integer;
  parsed_method := p_request -> 'method' ->> 'kind';
  parsed_method_details := (p_request -> 'method') - 'kind';

  if parsed_method is null then
    raise exception using errcode = '22023', message = 'purchase method is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'purchase request items must be an array';
  end if;

  -- A lease has no reagent lines to request — it originates a contract with
  -- zero contract_items, same invariant create_contract enforces. Every
  -- other method still needs at least one line.
  if jsonb_array_length(p_items) = 0 and parsed_method <> 'equipment_lease' then
    raise exception using errcode = '22023', message = 'purchase request must have at least one line';
  end if;

  if jsonb_array_length(p_items) > 0 and parsed_method = 'equipment_lease' then
    raise exception using errcode = '22023', message = 'a purchase request opening an equipment lease cannot have items';
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

create or replace function public.confirm_purchase_request(
  p_pr_id uuid,
  p_actor_id uuid,
  p_sent_to_procurement_date date default null
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  confirmed_request public.purchase_requests%rowtype;
  line public.purchase_request_items%rowtype;
  contract_draft jsonb;
  contract_items jsonb;
  new_contract public.contracts%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  -- Lock first, then re-read status under the lock. Checking before locking
  -- would let two officers both see 'pending' and both act on it.
  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if locked_request.status <> 'pending' then
    raise exception using
      errcode = '55000',
      message = format('purchase request is %s and cannot be confirmed', locked_request.status);
  end if;

  if locked_request.purchase_method in ('specific_contract', 'e_bidding', 'equipment_lease') then
    if p_sent_to_procurement_date is null then
      raise exception using
        errcode = '22004',
        message = 'sent-to-procurement date is required to open a contract from this purchase request';
    end if;

    contract_draft := locked_request.method_details -> 'contractDraft';
    if contract_draft is null then
      raise exception using errcode = '22023', message = 'purchase request is missing its contract draft';
    end if;

    -- A lease has no reagent lines to become contract_items — every other
    -- origination method turns every line on this PR into one. lsCode/name
    -- are read back from the inventory catalogue rather than trusted from
    -- the PR row, same as create_contract would insist on if called directly.
    if locked_request.purchase_method <> 'equipment_lease' then
      select jsonb_agg(
        jsonb_build_object(
          'lsCode', inventory_item.ls_code,
          'name', inventory_item.name,
          'quantity', item.requested_quantity,
          'unit', item.unit,
          'unitPrice', item.unit_price
        )
        order by item.line_number
      )
      into contract_items
      from public.purchase_request_items item
      join public.inventory_items inventory_item on inventory_item.id = item.inventory_item_id
      where item.purchase_request_id = p_pr_id;
    end if;

    -- create_contract is security invoker, called here inside the same
    -- transaction and under the same PR row lock — one atomic operation, not
    -- two RPCs a caller could interleave. The requester is the PR's own head
    -- or admin (assert_contract_editor_actor already let them submit it), so
    -- they become the contract's actor; the stock officer only supplies the
    -- date. fiscalYear/displayName/vendor are passed as jsonb (not text) so
    -- their JSON types survive unchanged into create_contract's own checks.
    -- create_contract's field allowlist rejects an unrecognised 'total' key
    -- outright for a non-lease type, so that key is only ever included below
    -- for the equipment_lease branch, never built with a null placeholder.
    if locked_request.purchase_method = 'equipment_lease' then
      select * into new_contract from public.create_contract(
        locked_request.requester_id,
        jsonb_build_object(
          'fiscalYear', contract_draft -> 'fiscalYear',
          'contractType', 'equipment_lease',
          'department', locked_request.department,
          'displayName', contract_draft -> 'displayName',
          'vendor', contract_draft -> 'vendor',
          'endDate', null::text,
          'total', contract_draft -> 'total'
        ),
        coalesce(contract_items, '[]'::jsonb),
        p_sent_to_procurement_date
      );
    else
      select * into new_contract from public.create_contract(
        locked_request.requester_id,
        jsonb_build_object(
          'fiscalYear', contract_draft -> 'fiscalYear',
          'contractType', case locked_request.purchase_method
            when 'specific_contract' then 'specific'
            when 'e_bidding' then 'e_bidding'
          end,
          'department', locked_request.department,
          'displayName', contract_draft -> 'displayName',
          'vendor', contract_draft -> 'vendor',
          'endDate', null::text
        ),
        coalesce(contract_items, '[]'::jsonb),
        p_sent_to_procurement_date
      );
    end if;

    -- sent_to_stock_officer_date is the date the requester recorded on the PR
    -- form (when they handed the request to the stock officer) — a different
    -- fact from sent_to_procurement_date, which the stock officer is entering
    -- right now via p_sent_to_procurement_date as they open the contract.
    update public.contracts
    set sent_to_stock_officer_date = (contract_draft ->> 'sentToStockOfficerDate')::date
    where id = new_contract.id;
  elsif p_sent_to_procurement_date is not null then
    raise exception using
      errcode = '22023',
      message = 'sent-to-procurement date only applies to a purchase request that opens a contract';
  end if;

  for line in
    select *
    from public.purchase_request_items item
    where item.purchase_request_id = p_pr_id
    order by item.line_number
  loop
    if line.contract_item_id is not null then
      -- validate_contract_item_allocation locks the contract item and rejects
      -- anything over the contracted quantity, so the ceiling holds even under
      -- concurrent confirmations.
      insert into public.contract_item_allocations (
        contract_item_id,
        purchase_request_item_id,
        allocation_kind,
        quantity,
        created_by
      )
      values (
        line.contract_item_id,
        line.id,
        'purchase_request',
        line.requested_quantity,
        p_actor_id
      );
    end if;
  end loop;

  update public.purchase_requests
  set status = 'completed',
      acknowledged_by = p_actor_id,
      acknowledged_at = now(),
      created_contract_id = new_contract.id,
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into confirmed_request;

  return confirmed_request;
end
$function$;

revoke execute on function public.create_contract(uuid, jsonb, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.create_contract(uuid, jsonb, jsonb, date, text) to service_role;

revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_purchase_request(uuid, jsonb, jsonb) to service_role;

revoke execute on function public.confirm_purchase_request(uuid, uuid, date) from public;
revoke execute on function public.confirm_purchase_request(uuid, uuid, date) from anon;
revoke execute on function public.confirm_purchase_request(uuid, uuid, date) from authenticated;
grant execute on function public.confirm_purchase_request(uuid, uuid, date) to service_role;

commit;
