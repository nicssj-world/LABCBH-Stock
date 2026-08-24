-- Out Lab contract origination belongs to stock operations. Keep editing and
-- stage advancement on the broader contract-editor policy, but do not let a
-- head create a new record by calling this RPC directly.

begin;

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
  perform public.assert_stock_officer_actor(p_actor_id);

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
      -- Registering an already-started contract skips history and stays admin-only.
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

revoke execute on function public.create_out_lab_contract(uuid, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.create_out_lab_contract(uuid, jsonb, date, text) to service_role;

commit;
