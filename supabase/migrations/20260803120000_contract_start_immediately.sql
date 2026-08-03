-- Adds an admin-only fast path to create_contract: supplying a contract
-- number creates the contract directly at 'contract_started' with a single
-- collapsed stage-history row, instead of the normal five-stage climb from
-- 'sent_to_procurement'. This is for contracts that already exist and are
-- already in use when they are entered into this system; forcing them
-- through fabricated intermediate stages would record a procurement history
-- that never happened.
--
-- This is a true "create or replace" of the same function, not a new
-- overload: the new p_contract_number parameter is appended with a default,
-- so every existing 4-arg caller is unaffected. The body is otherwise
-- reproduced verbatim from
-- supabase/migrations/20260802140000_contract_department_add_stock_and_poct.sql.
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
    where field_name not in ('fiscalYear', 'contractType', 'department', 'displayName', 'vendor', 'endDate')
  ) then
    raise exception using errcode = '22023', message = 'unexpected contract field';
  end if;

  if not (p_contract ?& array['fiscalYear', 'contractType', 'department', 'displayName', 'vendor', 'endDate'])
    or jsonb_typeof(p_contract -> 'fiscalYear') is distinct from 'number'
    or mod((p_contract ->> 'fiscalYear')::numeric, 1) <> 0
    or jsonb_typeof(p_contract -> 'contractType') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'department') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'displayName') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'vendor') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'endDate') not in ('string', 'null')
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

  select round(sum(
    (item ->> 'quantity')::numeric * (item ->> 'unitPrice')::numeric
  ), 2)
  into parsed_total
  from jsonb_array_elements(p_items) item;

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

revoke execute on function public.create_contract(uuid, jsonb, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.create_contract(uuid, jsonb, jsonb, date, text) to service_role;

commit;
