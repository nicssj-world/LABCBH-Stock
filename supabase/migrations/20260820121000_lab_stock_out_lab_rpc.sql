-- LABCBH Stock — writes for the Out Lab register.
--
-- Companion to 20260820120000_lab_stock_out_lab.sql. Every rule that must not
-- be bypassed lives here, under a lock on the contract row, in the same
-- transaction as the write. Application code only mirrors these checks so the
-- UI can hide what the database would refuse.
--
-- Two rules are specific to this register and worth stating up front:
--
-- 1. The ceiling is enforced for `contract_ceiling` rows only. An `annual_plan`
--    row is a *plan*: the send-out testing has already happened by the time
--    anyone types the figure in, so refusing the write would leave the system
--    holding a number that is knowingly wrong. Over-plan is surfaced in the UI
--    from the same snapshot instead.
--
-- 2. Recording a month is an upsert, because the register holds one figure per
--    month. That makes the ceiling arithmetic different from
--    record_contract_expense: the month being replaced must be excluded from
--    the committed sum, or correcting a figure *downwards* would be rejected
--    for exceeding a ceiling it is actually moving away from.

begin;

-- Editors may record against any Out Lab contract. Anyone named on one may
-- record against that one only — the people doing this day to day are Medical
-- Technologists who hold no editor role. Mirrors
-- assert_contract_expense_actor, but reads this register's own table.
create or replace function public.assert_out_lab_usage_actor(
  p_actor_id uuid,
  p_contract_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.out_lab_contracts contract
    join public.profiles profile on profile.id = p_actor_id
    where contract.id = p_contract_id
      and profile.status = 'active'
      and profile.deleted_at is null
      and p_actor_id = any (coalesce(contract.responsible_user_ids, '{}'::uuid[]))
  ) then
    return;
  end if;

  perform public.assert_contract_editor_actor(p_actor_id);
end
$function$;

create or replace function public.create_out_lab_contract(
  p_actor_id uuid,
  p_contract jsonb,
  p_effective_date date default null,
  p_contract_number text default null
)
returns public.out_lab_contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_contract public.out_lab_contracts%rowtype;
  parsed_kind text;
  parsed_cadence text;
  parsed_fiscal_year integer;
  parsed_total numeric(15,2);
  parsed_start_date date;
  parsed_end_date date;
  normalized_display_name text;
  normalized_contract_number text;
  initial_stage text;
  initial_status text;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  if p_contract is null or jsonb_typeof(p_contract) <> 'object' then
    raise exception using errcode = '22023', message = 'out lab contract payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_contract) field_name
    where field_name not in (
      'kind', 'entryCadence', 'fiscalYear', 'displayName',
      'vendor', 'department', 'total', 'startDate', 'endDate', 'note'
    )
  ) then
    raise exception using errcode = '22023', message = 'unexpected out lab contract field';
  end if;

  if not (p_contract ?& array['kind', 'entryCadence', 'fiscalYear', 'displayName'])
    or jsonb_typeof(p_contract -> 'kind') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'entryCadence') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'fiscalYear') is distinct from 'number'
    or mod((p_contract ->> 'fiscalYear')::numeric, 1) <> 0
    or jsonb_typeof(p_contract -> 'displayName') is distinct from 'string'
    or nullif(btrim(p_contract ->> 'displayName'), '') is null
    or jsonb_typeof(p_contract -> 'vendor') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'department') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'total') not in ('number', 'null')
    or jsonb_typeof(p_contract -> 'startDate') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'endDate') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'note') not in ('string', 'null')
  then
    raise exception using errcode = '22023', message = 'invalid out lab contract metadata';
  end if;

  parsed_kind := p_contract ->> 'kind';
  parsed_cadence := p_contract ->> 'entryCadence';
  parsed_fiscal_year := (p_contract ->> 'fiscalYear')::integer;
  normalized_display_name := btrim(p_contract ->> 'displayName');
  parsed_total := round((p_contract ->> 'total')::numeric, 2);

  -- Re-validated here as well as by the table CHECKs so the failure carries a
  -- message naming the field rather than a constraint name.
  if parsed_kind not in ('contract_ceiling', 'annual_plan') then
    raise exception using errcode = '22023', message = 'invalid out lab contract kind';
  end if;

  if parsed_cadence not in ('monthly', 'quarterly', 'as_needed') then
    raise exception using errcode = '22023', message = 'invalid out lab entry cadence';
  end if;

  if parsed_fiscal_year < 2500 or parsed_fiscal_year > 3000 then
    raise exception using errcode = '22023', message = 'invalid fiscal year';
  end if;

  if parsed_total is not null and parsed_total <= 0 then
    raise exception using errcode = '22023', message = 'total must be greater than zero';
  end if;

  if parsed_kind = 'annual_plan' then
    -- The plan *is* the fiscal year, so its period is derived rather than
    -- typed. Accepting dates here would let the two disagree.
    if p_contract ? 'startDate' or p_contract ? 'endDate' then
      raise exception using
        errcode = '22023',
        message = 'an annual plan derives its period from the fiscal year';
    end if;

    -- Thai fiscal year 2569 runs 1 Oct 2025 – 30 Sep 2026 (CE = BE - 543).
    parsed_start_date := make_date(parsed_fiscal_year - 543 - 1, 10, 1);
    parsed_end_date := make_date(parsed_fiscal_year - 543, 9, 30);

    if p_contract_number is not null then
      raise exception using
        errcode = '22023',
        message = 'an annual plan has no procurement stages';
    end if;

    initial_stage := null;
    initial_status := 'active';
  else
    if nullif(p_contract ->> 'startDate', '') is null or nullif(p_contract ->> 'endDate', '') is null then
      raise exception using
        errcode = '23502',
        message = 'a contract-ceiling row requires a start and end date';
    end if;

    parsed_start_date := (p_contract ->> 'startDate')::date;
    parsed_end_date := (p_contract ->> 'endDate')::date;

    if p_effective_date is null then
      raise exception using errcode = '22004', message = 'effective date is required';
    end if;

    normalized_contract_number := nullif(btrim(p_contract_number), '');

    if normalized_contract_number is null then
      initial_stage := 'sent_to_procurement';
      initial_status := 'pending';
    else
      -- Registering a contract that already started skips the stage history
      -- this system would otherwise have witnessed, so it is narrower than the
      -- editor role that governs everything else here.
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
        raise exception using
          errcode = '42501',
          message = 'actor is not allowed to register an already-started contract';
      end if;

      if exists (
        select 1 from public.out_lab_contracts contract
        where lower(btrim(contract.contract_number)) = lower(normalized_contract_number)
      ) then
        raise exception using errcode = '23505', message = 'เลขที่สัญญานี้มีอยู่แล้วในทะเบียน Out Lab';
      end if;

      initial_stage := 'contract_started';
      initial_status := 'active';
    end if;
  end if;

  if parsed_start_date > parsed_end_date then
    raise exception using errcode = '22007', message = 'วันสิ้นสุดสัญญาต้องไม่มาก่อนวันเริ่มสัญญา';
  end if;

  insert into public.out_lab_contracts (
    kind,
    entry_cadence,
    fiscal_year,
    display_name,
    vendor,
    department,
    contract_number,
    total,
    start_date,
    end_date,
    procurement_stage,
    sent_to_procurement_date,
    contract_started_date,
    stage_updated_at,
    status,
    note,
    created_by,
    updated_by
  ) values (
    parsed_kind,
    parsed_cadence,
    parsed_fiscal_year,
    normalized_display_name,
    nullif(btrim(p_contract ->> 'vendor'), ''),
    nullif(btrim(p_contract ->> 'department'), ''),
    normalized_contract_number,
    parsed_total,
    parsed_start_date,
    parsed_end_date,
    initial_stage,
    case when initial_stage = 'sent_to_procurement' then p_effective_date end,
    case when initial_stage = 'contract_started' then p_effective_date end,
    case when initial_stage is not null then now() end,
    initial_status,
    nullif(btrim(p_contract ->> 'note'), ''),
    p_actor_id,
    p_actor_id
  )
  returning * into created_contract;

  if initial_stage is not null then
    insert into public.out_lab_contract_stage_history (
      out_lab_contract_id,
      from_stage,
      to_stage,
      effective_date,
      contract_number_snapshot,
      source,
      actor_id
    ) values (
      created_contract.id,
      null,
      initial_stage,
      p_effective_date,
      normalized_contract_number,
      'labcbh_stock',
      p_actor_id
    );
  end if;

  return created_contract;
end
$function$;

create or replace function public.update_out_lab_contract(
  p_actor_id uuid,
  p_contract_id uuid,
  p_contract jsonb,
  p_expected_updated_at timestamptz
)
returns public.out_lab_contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_contract public.out_lab_contracts%rowtype;
  updated_contract public.out_lab_contracts%rowtype;
  parsed_fiscal_year integer;
  parsed_cadence text;
  parsed_total numeric(15,2);
  parsed_start_date date;
  parsed_end_date date;
  committed numeric(15,2);
  earliest_month date;
  latest_month date;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  if p_contract is null or jsonb_typeof(p_contract) <> 'object' then
    raise exception using errcode = '22023', message = 'out lab contract payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_contract) field_name
    where field_name not in (
      'kind', 'entryCadence', 'fiscalYear', 'displayName',
      'vendor', 'department', 'total', 'startDate', 'endDate', 'note'
    )
  ) then
    raise exception using errcode = '22023', message = 'unexpected out lab contract field';
  end if;

  if not (p_contract ?& array['entryCadence', 'fiscalYear', 'displayName'])
    or jsonb_typeof(p_contract -> 'entryCadence') is distinct from 'string'
    or jsonb_typeof(p_contract -> 'fiscalYear') is distinct from 'number'
    or mod((p_contract ->> 'fiscalYear')::numeric, 1) <> 0
    or jsonb_typeof(p_contract -> 'displayName') is distinct from 'string'
    or nullif(btrim(p_contract ->> 'displayName'), '') is null
    or jsonb_typeof(p_contract -> 'vendor') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'department') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'total') not in ('number', 'null')
    or jsonb_typeof(p_contract -> 'startDate') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'endDate') not in ('string', 'null')
    or jsonb_typeof(p_contract -> 'note') not in ('string', 'null')
  then
    raise exception using errcode = '22023', message = 'invalid out lab contract metadata';
  end if;

  select contract.* into current_contract
  from public.out_lab_contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  if current_contract.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'ข้อมูลสัญญาถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดหน้าใหม่';
  end if;

  if current_contract.is_archived then
    raise exception using errcode = '55000', message = 'สัญญาที่เก็บเข้าคลังแล้วแก้ไขไม่ได้';
  end if;

  -- A row that already carries recorded months cannot swap the rule its
  -- ceiling is judged by. Correcting a wrong choice means archiving the row
  -- and registering it again.
  if p_contract ? 'kind' and (p_contract ->> 'kind') is distinct from current_contract.kind then
    raise exception using
      errcode = '23514',
      message = 'ไม่สามารถเปลี่ยนประเภทสัญญาได้ หากเลือกผิดให้เก็บเข้าคลังแล้วสร้างใหม่';
  end if;

  parsed_cadence := p_contract ->> 'entryCadence';
  parsed_fiscal_year := (p_contract ->> 'fiscalYear')::integer;
  parsed_total := round((p_contract ->> 'total')::numeric, 2);

  if parsed_cadence not in ('monthly', 'quarterly', 'as_needed') then
    raise exception using errcode = '22023', message = 'invalid out lab entry cadence';
  end if;

  if parsed_fiscal_year < 2500 or parsed_fiscal_year > 3000 then
    raise exception using errcode = '22023', message = 'invalid fiscal year';
  end if;

  if parsed_total is not null and parsed_total <= 0 then
    raise exception using errcode = '22023', message = 'total must be greater than zero';
  end if;

  if current_contract.kind = 'annual_plan' then
    if p_contract ? 'startDate' or p_contract ? 'endDate' then
      raise exception using
        errcode = '22023',
        message = 'an annual plan derives its period from the fiscal year';
    end if;

    parsed_start_date := make_date(parsed_fiscal_year - 543 - 1, 10, 1);
    parsed_end_date := make_date(parsed_fiscal_year - 543, 9, 30);
  else
    if nullif(p_contract ->> 'startDate', '') is null or nullif(p_contract ->> 'endDate', '') is null then
      raise exception using
        errcode = '23502',
        message = 'a contract-ceiling row requires a start and end date';
    end if;

    parsed_start_date := (p_contract ->> 'startDate')::date;
    parsed_end_date := (p_contract ->> 'endDate')::date;
  end if;

  if parsed_start_date > parsed_end_date then
    raise exception using errcode = '22007', message = 'วันสิ้นสุดสัญญาต้องไม่มาก่อนวันเริ่มสัญญา';
  end if;

  select
    coalesce(sum(usage.amount), 0),
    min(usage.usage_month),
    max(usage.usage_month)
  into committed, earliest_month, latest_month
  from public.out_lab_monthly_usage usage
  where usage.out_lab_contract_id = p_contract_id;

  -- Narrowing the period must not strand a month that already holds a figure:
  -- it would stay in the total while no longer being reachable from the form.
  if earliest_month is not null
     and (earliest_month < date_trunc('month', parsed_start_date)::date
          or latest_month > date_trunc('month', parsed_end_date)::date) then
    raise exception using
      errcode = '23514',
      message = 'ช่วงเวลาใหม่ไม่ครอบคลุมเดือนที่บันทึกยอดไว้แล้ว';
  end if;

  -- Only a contract ceiling is a legal limit. An annual plan may be revised
  -- below what has already been spent; that is what "เกินแผน" means.
  if current_contract.kind = 'contract_ceiling'
     and parsed_total is not null
     and committed > parsed_total then
    raise exception using
      errcode = '23514',
      message = format(
        'มูลค่าสัญญาใหม่ต่ำกว่ายอดที่บันทึกไว้แล้ว (บันทึกแล้ว %s บาท)',
        to_char(committed, 'FM999,999,999.00')
      );
  end if;

  update public.out_lab_contracts
  set
    entry_cadence = parsed_cadence,
    fiscal_year = parsed_fiscal_year,
    display_name = btrim(p_contract ->> 'displayName'),
    vendor = nullif(btrim(p_contract ->> 'vendor'), ''),
    department = nullif(btrim(p_contract ->> 'department'), ''),
    total = parsed_total,
    start_date = parsed_start_date,
    end_date = parsed_end_date,
    note = nullif(btrim(p_contract ->> 'note'), ''),
    updated_by = p_actor_id
  where id = p_contract_id
  returning * into updated_contract;

  return updated_contract;
end
$function$;

create or replace function public.advance_out_lab_contract_stage(
  p_actor_id uuid,
  p_contract_id uuid,
  p_to_stage text,
  p_effective_date date,
  p_contract_number text default null,
  p_note text default null
)
returns public.out_lab_contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_contract public.out_lab_contracts%rowtype;
  updated_contract public.out_lab_contracts%rowtype;
  expected_stage text;
  normalized_contract_number text;
  latest_effective_date date;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  if p_effective_date is null then
    raise exception using errcode = '22004', message = 'effective date is required';
  end if;

  select contract.* into current_contract
  from public.out_lab_contracts contract
  where contract.id = p_contract_id
    and not contract.is_archived
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  -- An annual plan is not procured through this register; it is a budget line
  -- that already exists. The table CHECK keeps procurement_stage null for it,
  -- so this is the guard that produces a readable message instead.
  if current_contract.kind <> 'contract_ceiling' then
    raise exception using errcode = '23514', message = 'สัญญางบตามแผนไม่มีขั้นตอนจัดซื้อ';
  end if;

  if current_contract.status = 'cancelled' then
    raise exception using errcode = '55000', message = 'สัญญาที่ยกเลิกแล้วเดินขั้นตอนต่อไม่ได้';
  end if;

  select max(history.effective_date) into latest_effective_date
  from public.out_lab_contract_stage_history history
  where history.out_lab_contract_id = p_contract_id;

  if latest_effective_date is not null and p_effective_date < latest_effective_date then
    raise exception using
      errcode = '22007',
      message = 'วันที่มีผลต้องไม่ย้อนหลังกว่าขั้นตอนล่าสุด';
  end if;

  expected_stage := case current_contract.procurement_stage
    when 'sent_to_procurement' then 'plan_published'
    when 'plan_published' then 'tender_announced'
    when 'tender_announced' then 'result_consideration'
    when 'result_consideration' then 'winner_announced'
    when 'winner_announced' then 'contract_started'
    else null
  end;

  if expected_stage is null or p_to_stage is distinct from expected_stage then
    raise exception using
      errcode = '22023',
      message = format(
        'invalid procurement-stage transition from %s to %s',
        coalesce(current_contract.procurement_stage, '<null>'),
        coalesce(p_to_stage, '<null>')
      );
  end if;

  normalized_contract_number := nullif(btrim(p_contract_number), '');

  if p_to_stage = 'contract_started' then
    if normalized_contract_number is null then
      raise exception using errcode = '23502', message = 'กรุณาระบุเลขที่สัญญาเมื่อเริ่มสัญญา';
    end if;

    if exists (
      select 1 from public.out_lab_contracts contract
      where contract.id <> p_contract_id
        and lower(btrim(contract.contract_number)) = lower(normalized_contract_number)
    ) then
      raise exception using errcode = '23505', message = 'เลขที่สัญญานี้มีอยู่แล้วในทะเบียน Out Lab';
    end if;
  end if;

  update public.out_lab_contracts
  set
    procurement_stage = p_to_stage,
    contract_number = coalesce(normalized_contract_number, contract_number),
    status = case when p_to_stage = 'contract_started' then 'active' else status end,
    stage_updated_at = now(),
    plan_published_date = case when p_to_stage = 'plan_published' then p_effective_date else plan_published_date end,
    tender_announced_date = case when p_to_stage = 'tender_announced' then p_effective_date else tender_announced_date end,
    result_consideration_date = case when p_to_stage = 'result_consideration' then p_effective_date else result_consideration_date end,
    winner_announced_date = case when p_to_stage = 'winner_announced' then p_effective_date else winner_announced_date end,
    contract_started_date = case when p_to_stage = 'contract_started' then p_effective_date else contract_started_date end,
    updated_by = p_actor_id
  where id = p_contract_id
  returning * into updated_contract;

  insert into public.out_lab_contract_stage_history (
    out_lab_contract_id,
    from_stage,
    to_stage,
    effective_date,
    contract_number_snapshot,
    note,
    source,
    actor_id
  ) values (
    p_contract_id,
    current_contract.procurement_stage,
    p_to_stage,
    p_effective_date,
    updated_contract.contract_number,
    nullif(btrim(p_note), ''),
    'labcbh_stock',
    p_actor_id
  );

  return updated_contract;
end
$function$;

create or replace function public.record_out_lab_monthly_usage(
  p_actor_id uuid,
  p_contract_id uuid,
  p_amount numeric,
  p_usage_month date,
  p_note text default null
)
returns public.out_lab_monthly_usage
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract public.out_lab_contracts%rowtype;
  committed numeric(15,2);
  actor_name text;
  saved public.out_lab_monthly_usage%rowtype;
begin
  perform public.assert_out_lab_usage_actor(p_actor_id, p_contract_id);

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '23514', message = 'จำนวนเงินต้องมากกว่า 0';
  end if;

  if p_usage_month is null then
    raise exception using errcode = '23502', message = 'กรุณาระบุเดือนที่ใช้จ่าย';
  end if;

  if date_trunc('month', p_usage_month)::date <> p_usage_month then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายต้องเป็นวันที่ 1 ของเดือน';
  end if;

  -- This lock is the whole point: it serialises every entry on this contract,
  -- so two concurrent writers cannot both read the same remaining balance.
  select contract.* into target_contract
  from public.out_lab_contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  if target_contract.is_archived then
    raise exception using errcode = '55000', message = 'สัญญาที่เก็บเข้าคลังแล้วบันทึกยอดไม่ได้';
  end if;

  if target_contract.status = 'cancelled' then
    raise exception using errcode = '55000', message = 'สัญญาที่ยกเลิกแล้วบันทึกยอดไม่ได้';
  end if;

  if target_contract.status = 'expired' then
    raise exception using errcode = '55000', message = 'สัญญาที่สิ้นสุดแล้วบันทึกยอดไม่ได้';
  end if;

  if target_contract.kind = 'contract_ceiling'
     and target_contract.procurement_stage is distinct from 'contract_started' then
    raise exception using errcode = '55000', message = 'สัญญายังไม่เริ่ม จึงยังบันทึกยอดไม่ได้';
  end if;

  if p_usage_month < date_trunc('month', target_contract.start_date)::date then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายอยู่ก่อนวันเริ่มสัญญา';
  end if;

  if p_usage_month > date_trunc('month', target_contract.end_date)::date then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายอยู่หลังวันสิ้นสุดสัญญา';
  end if;

  -- Only a contract ceiling is a legal limit; an annual plan is monitored in
  -- the UI and never blocked here (see this file's header).
  if target_contract.kind = 'contract_ceiling' and target_contract.total is not null then
    -- Excluding the month being written is what makes this an upsert rather
    -- than an append: without it, correcting a figure downwards would be
    -- measured against a sum that still contains the figure being replaced.
    select coalesce(sum(usage.amount), 0) into committed
    from public.out_lab_monthly_usage usage
    where usage.out_lab_contract_id = p_contract_id
      and usage.usage_month <> p_usage_month;

    if committed + p_amount > target_contract.total then
      raise exception using
        errcode = '23514',
        message = format(
          'จำนวนเงินเกินมูลค่าคงเหลือ (คงเหลือ %s บาท)',
          to_char(target_contract.total - committed, 'FM999,999,999.00')
        );
    end if;
  end if;

  select profile.name into actor_name from public.profiles profile where profile.id = p_actor_id;

  insert into public.out_lab_monthly_usage (
    out_lab_contract_id, usage_month, amount, note, recorded_by, recorded_by_id, updated_by
  ) values (
    p_contract_id,
    p_usage_month,
    p_amount,
    nullif(btrim(p_note), ''),
    actor_name,
    p_actor_id,
    p_actor_id
  )
  on conflict (out_lab_contract_id, usage_month) do update
  set
    amount = excluded.amount,
    note = excluded.note,
    recorded_by = excluded.recorded_by,
    recorded_by_id = excluded.recorded_by_id,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into saved;

  return saved;
end
$function$;

create or replace function public.delete_out_lab_monthly_usage(
  p_actor_id uuid,
  p_usage_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract_id uuid;
begin
  select usage.out_lab_contract_id into target_contract_id
  from public.out_lab_monthly_usage usage
  where usage.id = p_usage_id;

  if target_contract_id is null then
    raise exception using errcode = 'P0002', message = 'ไม่พบรายการค่าใช้จ่าย';
  end if;

  perform public.assert_out_lab_usage_actor(p_actor_id, target_contract_id);

  delete from public.out_lab_monthly_usage where id = p_usage_id;
end
$function$;

create or replace function public.set_out_lab_responsible_users(
  p_actor_id uuid,
  p_contract_id uuid,
  p_profile_ids uuid[],
  p_note text default null
)
returns public.out_lab_contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous uuid[];
  next_ids uuid[];
  updated public.out_lab_contracts%rowtype;
  candidate uuid;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  next_ids := coalesce(p_profile_ids, '{}'::uuid[]);

  if exists (
    select 1 from unnest(next_ids) as wanted(id)
    left join public.profiles profile on profile.id = wanted.id
    where profile.id is null or profile.status <> 'active' or profile.deleted_at is not null
  ) then
    raise exception using errcode = '23503', message = 'มีผู้รับผิดชอบที่ไม่ใช่ผู้ใช้งานที่ใช้งานอยู่';
  end if;

  select contract.responsible_user_ids into previous
  from public.out_lab_contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  previous := coalesce(previous, '{}'::uuid[]);

  update public.out_lab_contracts
  set responsible_user_ids = next_ids,
      updated_by = p_actor_id
  where id = p_contract_id
  returning * into updated;

  -- One audit row per person added and per person removed, so a grant that was
  -- given and later withdrawn is still visible after the fact.
  foreach candidate in array (select coalesce(array(select unnest(next_ids) except select unnest(previous)), '{}'::uuid[])) loop
    insert into public.out_lab_responsible_audit
      (out_lab_contract_id, profile_id, actor_id, previous_assigned, next_assigned, note)
    values (p_contract_id, candidate, p_actor_id, false, true, nullif(btrim(p_note), ''));
  end loop;

  foreach candidate in array (select coalesce(array(select unnest(previous) except select unnest(next_ids)), '{}'::uuid[])) loop
    insert into public.out_lab_responsible_audit
      (out_lab_contract_id, profile_id, actor_id, previous_assigned, next_assigned, note)
    values (p_contract_id, candidate, p_actor_id, true, false, nullif(btrim(p_note), ''));
  end loop;

  return updated;
end
$function$;

create or replace function public.set_out_lab_contract_file(
  p_actor_id uuid,
  p_contract_id uuid,
  p_file_url text
)
returns public.out_lab_contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.out_lab_contracts%rowtype;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  update public.out_lab_contracts
  set file_url = nullif(btrim(p_file_url), ''),
      updated_by = p_actor_id
  where id = p_contract_id
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  return updated;
end
$function$;

-- Archiving is for a mistaken or duplicate record, not for a contract that
-- ended normally — that is what expiry is for.
create or replace function public.archive_out_lab_contract(
  p_actor_id uuid,
  p_contract_id uuid,
  p_reason text
)
returns public.out_lab_contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.out_lab_contracts%rowtype;
  normalized_reason text;
begin
  perform public.assert_lab_stock_admin_actor(p_actor_id);

  normalized_reason := nullif(btrim(p_reason), '');
  if normalized_reason is null then
    raise exception using errcode = '22023', message = 'กรุณาระบุเหตุผลในการเก็บเข้าคลัง';
  end if;

  update public.out_lab_contracts
  set is_archived = true,
      archived_at = now(),
      archived_by = p_actor_id,
      archive_reason = normalized_reason,
      updated_by = p_actor_id
  where id = p_contract_id
    and not is_archived
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญาที่ยังไม่ถูกเก็บเข้าคลัง';
  end if;

  return updated;
end
$function$;

create or replace function public.restore_out_lab_contract(
  p_actor_id uuid,
  p_contract_id uuid
)
returns public.out_lab_contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.out_lab_contracts%rowtype;
begin
  perform public.assert_lab_stock_admin_actor(p_actor_id);

  update public.out_lab_contracts
  set is_archived = false,
      archived_at = null,
      archived_by = null,
      archive_reason = null,
      updated_by = p_actor_id
  where id = p_contract_id
    and is_archived
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญาที่ถูกเก็บเข้าคลัง';
  end if;

  return updated;
end
$function$;

create or replace function public.expire_out_lab_contract(
  p_actor_id uuid,
  p_contract_id uuid,
  p_reason text
)
returns public.out_lab_contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_contract public.out_lab_contracts%rowtype;
  updated public.out_lab_contracts%rowtype;
  normalized_reason text;
begin
  perform public.assert_lab_stock_admin_actor(p_actor_id);

  normalized_reason := nullif(btrim(p_reason), '');
  if normalized_reason is null then
    raise exception using errcode = '22023', message = 'กรุณาระบุเหตุผลในการสิ้นสุดสัญญา';
  end if;

  select contract.* into current_contract
  from public.out_lab_contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  if current_contract.status <> 'active' then
    raise exception using errcode = '55000', message = 'สัญญานี้ไม่ได้อยู่ระหว่างใช้งาน';
  end if;

  if current_contract.kind = 'contract_ceiling'
     and current_contract.procurement_stage is distinct from 'contract_started' then
    raise exception using errcode = '55000', message = 'สัญญายังไม่เริ่ม จึงสิ้นสุดสัญญาไม่ได้';
  end if;

  update public.out_lab_contracts
  set status = 'expired',
      source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object(
        'contract_status_change', jsonb_build_object(
          'status', 'expired',
          'reason', normalized_reason,
          'changed_at', now(),
          'actor_id', p_actor_id
        )
      ),
      updated_by = p_actor_id
  where id = p_contract_id
  returning * into updated;

  return updated;
end
$function$;

revoke execute on function public.assert_out_lab_usage_actor(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assert_out_lab_usage_actor(uuid, uuid) to service_role;

revoke execute on function public.create_out_lab_contract(uuid, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.create_out_lab_contract(uuid, jsonb, date, text) to service_role;

revoke execute on function public.update_out_lab_contract(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.update_out_lab_contract(uuid, uuid, jsonb, timestamptz) to service_role;

revoke execute on function public.advance_out_lab_contract_stage(uuid, uuid, text, date, text, text) from public, anon, authenticated;
grant execute on function public.advance_out_lab_contract_stage(uuid, uuid, text, date, text, text) to service_role;

revoke execute on function public.record_out_lab_monthly_usage(uuid, uuid, numeric, date, text) from public, anon, authenticated;
grant execute on function public.record_out_lab_monthly_usage(uuid, uuid, numeric, date, text) to service_role;

revoke execute on function public.delete_out_lab_monthly_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_out_lab_monthly_usage(uuid, uuid) to service_role;

revoke execute on function public.set_out_lab_responsible_users(uuid, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.set_out_lab_responsible_users(uuid, uuid, uuid[], text) to service_role;

revoke execute on function public.set_out_lab_contract_file(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_out_lab_contract_file(uuid, uuid, text) to service_role;

revoke execute on function public.archive_out_lab_contract(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.archive_out_lab_contract(uuid, uuid, text) to service_role;

revoke execute on function public.restore_out_lab_contract(uuid, uuid) from public, anon, authenticated;
grant execute on function public.restore_out_lab_contract(uuid, uuid) to service_role;

revoke execute on function public.expire_out_lab_contract(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.expire_out_lab_contract(uuid, uuid, text) to service_role;

commit;
