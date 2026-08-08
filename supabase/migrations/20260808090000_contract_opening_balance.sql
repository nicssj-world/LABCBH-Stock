-- A supply contract imported by the admin-only "already started" fast path
-- (create_contract's p_contract_number path, 20260803150000) always shows
-- 100% remaining, because nothing in this system has ever recorded that a
-- paper-signed contract was partially spent before it was registered here.
-- That is wrong for e-bidding contracts cut over mid-life, and it silently
-- corrupts the register's remaining%, the dashboard watchlist, and the
-- purchase-request contract-item picker, which all read the same
-- contract_item_allocations ledger.
--
-- This adds a fourth allocation_kind, 'opening_balance', alongside the
-- existing purchase_request / reversal / legacy_import kinds. It reuses every
-- guard the ledger already has (validate_contract_item_allocation's FOR
-- UPDATE lock and over-allocation check, the append-only trigger, the cannot-
-- remove-an-allocated-item guard in update_contract) rather than duplicating
-- them. It is deliberately a fourth kind and not a reuse of 'legacy_import':
-- that kind's arm requires a unique source_identity and is the audit surface
-- of the Google Sheets CLI import (scripts/import-google-sheets.mts) and
-- lab_stock_import_runs; mixing admin-typed figures into it would break that
-- reconciliation.
--
-- This migration never reads or writes the physical stock ledger in any way:
-- an opening balance is a contractual commitment already spent outside this
-- system, not a stock event. Nothing here creates a goods receipt, a lot, or
-- a movement of physical stock.
begin;

alter table public.contract_item_allocations
  drop constraint contract_item_allocations_allocation_kind_check;

alter table public.contract_item_allocations
  add constraint contract_item_allocations_allocation_kind_check
  check (allocation_kind in ('purchase_request', 'reversal', 'legacy_import', 'opening_balance'));

alter table public.contract_item_allocations
  drop constraint contract_item_allocations_check;

alter table public.contract_item_allocations
  add constraint contract_item_allocations_check
  check (
    (
      allocation_kind = 'purchase_request'
      and quantity > 0
      and purchase_request_item_id is not null
      and reference_allocation_id is null
      and source_identity is null
    )
    or (
      allocation_kind = 'legacy_import'
      and quantity > 0
      and purchase_request_item_id is null
      and reference_allocation_id is null
      and nullif(btrim(source_identity), '') is not null
      and source_metadata <> '{}'::jsonb
    )
    or (
      allocation_kind = 'reversal'
      and quantity < 0
      and purchase_request_item_id is null
      and reference_allocation_id is not null
      and source_identity is null
    )
    or (
      -- No fixed sign: this is a signed delta against the previously recorded
      -- opening balance for the line, so a downward correction is negative.
      allocation_kind = 'opening_balance'
      and purchase_request_item_id is null
      and reference_allocation_id is null
      and source_identity is null
      and nullif(btrim(note), '') is not null
      and source_metadata <> '{}'::jsonb
    )
  );

-- Records (or corrects) how much of each line an already-started supply
-- contract had used before it was registered here. The caller supplies the
-- target "used so far" quantity per line; this stores only the delta against
-- what is already recorded, so calling it twice with the same target is a
-- no-op and a correction leaves a full history rather than an edited row.
create or replace function public.set_contract_opening_balances(
  p_contract_id bigint,
  p_actor_id uuid,
  p_lines jsonb,
  p_effective_date date,
  p_note text
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract public.contracts%rowtype;
  normalized_note text;
  line jsonb;
  line_item_id uuid;
  target_quantity numeric(15,3);
  locked_item public.contract_items%rowtype;
  previous_quantity numeric(15,3);
  delta numeric(15,3);
begin
  perform public.assert_lab_stock_admin_actor(p_actor_id);

  if p_effective_date is null then
    raise exception using errcode = '22004', message = 'effective date is required';
  end if;

  normalized_note := nullif(btrim(p_note), '');
  if normalized_note is null then
    raise exception using errcode = '22023', message = 'opening balance note is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'opening balance lines must be a non-empty array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item
    where jsonb_typeof(item) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(item) field_name
        where field_name not in ('contractItemId', 'usedQuantity')
      )
  ) then
    raise exception using errcode = '22023', message = 'unexpected opening balance field';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item
    where jsonb_typeof(item -> 'contractItemId') is distinct from 'string'
      or jsonb_typeof(item -> 'usedQuantity') is distinct from 'number'
      or (item ->> 'usedQuantity')::numeric < 0
  ) then
    raise exception using errcode = '22023', message = 'invalid opening balance line';
  end if;

  if (
    select count(distinct item ->> 'contractItemId')
    from jsonb_array_elements(p_lines) item
  ) <> jsonb_array_length(p_lines) then
    raise exception using errcode = '22023', message = 'duplicate contract item in opening balance lines';
  end if;

  select * into target_contract
  from public.contracts
  where id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'contract not found';
  end if;

  if coalesce(target_contract.is_archived, false) then
    raise exception using errcode = '55000', message = 'archived contract cannot record an opening balance';
  end if;

  if target_contract.contract_type = 'equipment_lease' then
    raise exception using errcode = '22023', message = 'opening balance is only valid on a supply contract';
  end if;

  if target_contract.procurement_stage is distinct from 'contract_started' then
    raise exception using errcode = '55000', message = 'contract has not started';
  end if;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    line_item_id := (line ->> 'contractItemId')::uuid;
    target_quantity := (line ->> 'usedQuantity')::numeric;

    select * into locked_item
    from public.contract_items
    where id = line_item_id
      and contract_id = p_contract_id
    for update;

    if not found then
      raise exception using errcode = '22023', message = 'contract item does not belong to contract';
    end if;

    select coalesce(sum(quantity), 0)
    into previous_quantity
    from public.contract_item_allocations
    where contract_item_id = line_item_id
      and allocation_kind = 'opening_balance';

    delta := target_quantity - previous_quantity;
    if delta = 0 then
      continue;
    end if;

    -- validate_contract_item_allocation (existing trigger) re-locks
    -- contract_items and rejects a total that exceeds the line's contracted
    -- quantity or drops committed quantity below zero, exactly as it already
    -- does for purchase_request and legacy_import rows.
    insert into public.contract_item_allocations (
      contract_item_id,
      allocation_kind,
      quantity,
      note,
      source_metadata,
      created_by
    ) values (
      line_item_id,
      'opening_balance',
      delta,
      normalized_note,
      jsonb_build_object(
        'source', 'labcbh_stock',
        'effective_date', p_effective_date,
        'previous_quantity', previous_quantity,
        'target_quantity', target_quantity
      ),
      p_actor_id
    );
  end loop;

  return target_contract;
end
$function$;

revoke execute on function public.set_contract_opening_balances(bigint, uuid, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.set_contract_opening_balances(bigint, uuid, jsonb, date, text) to service_role;

-- create_contract, replaced to accept a per-line opening balance on the same
-- admin-only "already started" fast path. Everything else is unchanged from
-- 20260803150000_pr_lease_origination.sql.
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
        where field_name not in ('lsCode', 'name', 'quantity', 'unit', 'unitPrice', 'openingUsedQuantity')
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

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where item ? 'openingUsedQuantity'
      and (
        jsonb_typeof(item -> 'openingUsedQuantity') is distinct from 'number'
        or (item ->> 'openingUsedQuantity')::numeric < 0
        or (item ->> 'openingUsedQuantity')::numeric > (item ->> 'quantity')::numeric
      )
  ) then
    raise exception using errcode = '22023', message = 'invalid contract item opening balance';
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

  -- An opening balance only reconciles against a contract that already has a
  -- number: a contract still climbing the normal procurement stages has
  -- nothing paper-signed to have partially used yet.
  if normalized_contract_number is null and exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce((item ->> 'openingUsedQuantity')::numeric, 0) > 0
  ) then
    raise exception using errcode = '22023', message = 'opening balance requires an already-started contract';
  end if;

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

  -- A separate statement, not folded into the insert above: the allocation
  -- trigger reads contract_items with its own snapshot and would not see
  -- rows a sibling CTE had not yet committed, raising a spurious
  -- "contract item not found".
  insert into public.contract_item_allocations (
    contract_item_id,
    allocation_kind,
    quantity,
    note,
    source_metadata,
    created_by
  )
  select
    item_row.id,
    'opening_balance',
    (item ->> 'openingUsedQuantity')::numeric,
    'ยอดใช้ก่อนเข้าระบบ (บันทึกพร้อมสร้างสัญญา)',
    jsonb_build_object(
      'source', 'labcbh_stock',
      'effective_date', p_effective_date,
      'previous_quantity', 0,
      'target_quantity', (item ->> 'openingUsedQuantity')::numeric
    ),
    p_actor_id
  from jsonb_array_elements(p_items) with ordinality as payload(item, item_order)
  join public.contract_items item_row
    on item_row.contract_id = created_contract.id
   and item_row.line_number = item_order::integer
  where coalesce((item ->> 'openingUsedQuantity')::numeric, 0) > 0;

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

revoke execute on function public.create_contract(uuid, jsonb, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.create_contract(uuid, jsonb, jsonb, date, text) to service_role;

commit;
