-- Adds two department values requested for contract attribution: the stock
-- office itself ("คลังน้ำยาและวัสดุวิทยาศาสตร์") and point-of-care testing
-- ("POCT").
-- Neither existed when 20260802090000_lab_stock_contract_department.sql fixed
-- the allowed list, so both contracts_department_check and the inline lists
-- in create_contract/update_contract are extended here. Reproduced verbatim
-- from that migration apart from the two additional department values.
begin;

alter table public.contracts
  drop constraint contracts_department_check;

alter table public.contracts
  add constraint contracts_department_check
  check (department in (
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
  ));

create or replace function public.create_contract(
  p_actor_id uuid,
  p_contract jsonb,
  p_items jsonb,
  p_effective_date date
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
    stage_updated_at,
    source_metadata
  ) values (
    normalized_vendor,
    normalized_display_name,
    parsed_total,
    parsed_end_date,
    'pending',
    null,
    parsed_fiscal_year,
    parsed_contract_type,
    parsed_department,
    'sent_to_procurement',
    normalized_display_name,
    p_effective_date,
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
    'sent_to_procurement',
    p_effective_date,
    null,
    null,
    'labcbh_stock',
    p_actor_id
  );

  return created_contract;
end
$function$;

create or replace function public.update_contract(
  p_contract_id bigint,
  p_actor_id uuid,
  p_contract jsonb,
  p_items jsonb,
  p_expected_updated_at timestamptz
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_contract public.contracts%rowtype;
  normalized_display_name text;
  normalized_vendor text;
  parsed_fiscal_year integer;
  parsed_contract_type text;
  parsed_department text;
  parsed_end_date date;
  parsed_total numeric(17,2);
begin
  perform public.assert_contract_editor_actor(p_actor_id);

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

  -- Same rule as create: a lease carries no items, everything else needs one.
  if jsonb_array_length(p_items) = 0
     and (p_contract ->> 'contractType') is distinct from 'equipment_lease' then
    raise exception using errcode = '22023', message = 'contract requires a nonempty item array';
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
        where field_name not in ('id', 'lsCode', 'name', 'quantity', 'unit', 'unitPrice')
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
      or (
        item ? 'id'
        and jsonb_typeof(item -> 'id') not in ('string', 'null')
      )
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

  if (
    select count(*)
    from jsonb_array_elements(p_items) item
    where nullif(item ->> 'id', '') is not null
  ) <> (
    select count(distinct item ->> 'id')
    from jsonb_array_elements(p_items) item
    where nullif(item ->> 'id', '') is not null
  ) then
    raise exception using errcode = '22023', message = 'duplicate contract item id';
  end if;

  select contract.*
  into current_contract
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'contract not found';
  end if;

  if coalesce(current_contract.is_archived, false) then
    raise exception using errcode = '55000', message = 'archived contract cannot be edited';
  end if;

  if current_contract.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'expected updated_at does not match current contract';
  end if;

  perform 1
  from public.contract_items item
  where item.contract_id = p_contract_id
  for update;

  if exists (
    select 1
    from jsonb_array_elements(p_items) payload(item)
    left join public.contract_items existing
      on existing.id = nullif(payload.item ->> 'id', '')::uuid
      and existing.contract_id = p_contract_id
    where nullif(payload.item ->> 'id', '') is not null
      and existing.id is null
  ) then
    raise exception using errcode = '22023', message = 'contract item id does not belong to contract';
  end if;

  if exists (
    select 1
    from public.contract_items existing
    where existing.contract_id = p_contract_id
      and not exists (
        select 1
        from jsonb_array_elements(p_items) payload(item)
        where nullif(payload.item ->> 'id', '')::uuid = existing.id
      )
      and exists (
        select 1
        from public.contract_item_allocations allocation
        where allocation.contract_item_id = existing.id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'cannot remove an allocated contract item';
  end if;

  delete from public.contract_items existing
  where existing.contract_id = p_contract_id
    and not exists (
      select 1
      from jsonb_array_elements(p_items) payload(item)
      where nullif(payload.item ->> 'id', '')::uuid = existing.id
    );

  update public.contract_items
  set line_number = line_number + 1000000
  where contract_id = p_contract_id;

  update public.contract_items existing
  set
    line_number = payload.item_order::integer,
    ls_code = btrim(payload.item ->> 'lsCode'),
    name = btrim(payload.item ->> 'name'),
    quantity = (payload.item ->> 'quantity')::numeric,
    unit = btrim(payload.item ->> 'unit'),
    unit_price = (payload.item ->> 'unitPrice')::numeric,
    updated_by = p_actor_id
  from jsonb_array_elements(p_items) with ordinality as payload(item, item_order)
  where existing.id = nullif(payload.item ->> 'id', '')::uuid
    and existing.contract_id = p_contract_id;

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
    p_contract_id,
    payload.item_order::integer,
    btrim(payload.item ->> 'lsCode'),
    btrim(payload.item ->> 'name'),
    (payload.item ->> 'quantity')::numeric,
    btrim(payload.item ->> 'unit'),
    (payload.item ->> 'unitPrice')::numeric,
    p_actor_id,
    p_actor_id,
    jsonb_build_object('source', 'labcbh_stock')
  from jsonb_array_elements(p_items) with ordinality as payload(item, item_order)
  where nullif(payload.item ->> 'id', '') is null;

  normalized_display_name := nullif(btrim(p_contract ->> 'displayName'), '');
  normalized_vendor := nullif(btrim(p_contract ->> 'vendor'), '');
  parsed_fiscal_year := (p_contract ->> 'fiscalYear')::integer;
  parsed_contract_type := p_contract ->> 'contractType';
  parsed_department := p_contract ->> 'department';
  parsed_end_date := nullif(p_contract ->> 'endDate', '')::date;

  if normalized_display_name is null
    or parsed_fiscal_year not between 2500 and 3000
    or parsed_contract_type not in (
      'equipment_lease', 'e_bidding', 'annual_specific', 'specific',
      'off_plan', 'awaiting_equipment_lease', 'thai_red_cross'
    )
    or parsed_department not in (
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
    )
  then
    raise exception using errcode = '22023', message = 'invalid contract metadata';
  end if;

  select round(sum(
    (item ->> 'quantity')::numeric * (item ->> 'unitPrice')::numeric
  ), 2)
  into parsed_total
  from jsonb_array_elements(p_items) item;

  update public.contracts
  set
    fiscal_year = parsed_fiscal_year,
    contract_type = parsed_contract_type,
    department = parsed_department,
    display_name = normalized_display_name,
    product = normalized_display_name,
    vendor = normalized_vendor,
    end_date = parsed_end_date,
    total = parsed_total
  where id = p_contract_id
  returning * into current_contract;

  return current_contract;
end
$function$;

revoke execute on function public.create_contract(uuid, jsonb, jsonb, date) from public, anon, authenticated;
grant execute on function public.create_contract(uuid, jsonb, jsonb, date) to service_role;

revoke execute on function public.update_contract(bigint, uuid, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.update_contract(bigint, uuid, jsonb, jsonb, timestamptz) to service_role;

commit;
