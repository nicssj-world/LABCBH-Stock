-- Carry service-procurement plan masters into the current Bangkok fiscal year.
-- Transaction history stays on the source plan; only master data is copied.
begin;

alter table public.service_procurement_plans
  add column if not exists rollover_source_plan_id uuid
    references public.service_procurement_plans(id) on delete restrict;

create unique index if not exists service_procurement_plans_rollover_source_year_uidx
  on public.service_procurement_plans (rollover_source_plan_id, fiscal_year)
  where rollover_source_plan_id is not null;

create index if not exists service_procurement_plans_rollover_source_idx
  on public.service_procurement_plans (rollover_source_plan_id)
  where rollover_source_plan_id is not null;

create table if not exists public.service_plan_rollover_runs (
  id uuid primary key default gen_random_uuid(),
  source_fiscal_year integer not null check (source_fiscal_year between 2500 and 3000),
  target_fiscal_year integer not null check (target_fiscal_year between 2500 and 3000),
  selected_count integer not null check (selected_count >= 0),
  excluded_count integer not null check (excluded_count >= 0),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (target_fiscal_year = source_fiscal_year + 1)
);

create index if not exists service_plan_rollover_runs_target_idx
  on public.service_plan_rollover_runs (target_fiscal_year, created_at desc);

alter table public.service_plan_rollover_runs enable row level security;
revoke all on table public.service_plan_rollover_runs from public, anon, authenticated;
grant select, insert on table public.service_plan_rollover_runs to service_role;

create or replace function public.service_plan_fiscal_year_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.fiscal_year is distinct from old.fiscal_year then
    raise exception using
      errcode = '55000',
      message = 'service plan fiscal year is immutable; create a rollover plan instead';
  end if;
  return new;
end
$function$;

revoke execute on function public.service_plan_fiscal_year_immutable() from public, anon, authenticated;
drop trigger if exists service_plan_fiscal_year_immutable on public.service_procurement_plans;
create trigger service_plan_fiscal_year_immutable
before update of fiscal_year on public.service_procurement_plans
for each row execute function public.service_plan_fiscal_year_immutable();

create or replace function public.service_purchase_request_current_fiscal_year_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  plan_row public.service_procurement_plans%rowtype;
  v_current_fiscal_year integer;
begin
  if tg_op = 'UPDATE' then
    if new.fiscal_year is distinct from old.fiscal_year then
      raise exception using errcode = '55000', message = 'service PR fiscal year is immutable';
    end if;
    if new.plan_id is not distinct from old.plan_id then
      return new;
    end if;
  end if;

  if new.plan_id is null then
    raise exception using errcode = '23514', message = 'service purchase request requires a referenced plan';
  end if;

  select plan.* into plan_row
  from public.service_procurement_plans as plan
  where plan.id = new.plan_id;
  if not found then
    raise exception using errcode = '23503', message = 'service plan not found';
  end if;

  v_current_fiscal_year := public.service_procurement_fiscal_year((timezone('Asia/Bangkok', now()))::date);
  if tg_op = 'INSERT' and plan_row.fiscal_year <> v_current_fiscal_year then
    raise exception using errcode = '55000', message = 'service PR must reference a plan in the current fiscal year';
  end if;
  if tg_op = 'UPDATE' and plan_row.fiscal_year <> old.fiscal_year then
    raise exception using errcode = '55000', message = 'historical service PR cannot move to a plan in another fiscal year';
  end if;
  if new.fiscal_year is distinct from plan_row.fiscal_year then
    raise exception using errcode = '23514', message = 'service PR fiscal year must match its plan';
  end if;
  return new;
end
$function$;

revoke execute on function public.service_purchase_request_current_fiscal_year_guard() from public, anon, authenticated;
drop trigger if exists service_purchase_request_current_fiscal_year_guard on public.service_purchase_requests;
create trigger service_purchase_request_current_fiscal_year_guard
before insert or update of plan_id, fiscal_year on public.service_purchase_requests
for each row execute function public.service_purchase_request_current_fiscal_year_guard();

-- Every copied child record participates in the source optimistic lock.
create or replace function public.service_plan_rollover_touch_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_plan_id uuid;
begin
  v_plan_id := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
  update public.service_procurement_plans as plan
  set updated_at = clock_timestamp()
  where plan.id = v_plan_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

revoke execute on function public.service_plan_rollover_touch_parent() from public, anon, authenticated;
drop trigger if exists service_plan_test_items_touch_parent on public.service_plan_test_items;
create trigger service_plan_test_items_touch_parent
after insert or update or delete on public.service_plan_test_items
for each row execute function public.service_plan_rollover_touch_parent();
drop trigger if exists service_plan_responsibles_touch_parent on public.service_plan_responsibles;
create trigger service_plan_responsibles_touch_parent
after insert or update or delete on public.service_plan_responsibles
for each row execute function public.service_plan_rollover_touch_parent();

create or replace function public.rollover_service_procurement_plans(
  p_actor_id uuid,
  p_source_fiscal_year integer,
  p_target_fiscal_year integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_source_fiscal_year integer := p_source_fiscal_year;
  v_target_fiscal_year integer := p_target_fiscal_year;
  v_current_fiscal_year integer;
  v_selected_count integer;
  v_source_count integer;
  v_excluded_count integer;
  v_run_id uuid;
  v_created_plan_ids uuid[] := '{}'::uuid[];
  v_active_profile_ids uuid[];
  v_expected_profile_ids uuid[];
  payload_item jsonb;
  source_plan public.service_procurement_plans%rowtype;
  created_plan public.service_procurement_plans%rowtype;
  v_budget numeric(17,2);
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'service plan rollover items must be an array';
  end if;

  v_current_fiscal_year := public.service_procurement_fiscal_year((timezone('Asia/Bangkok', now()))::date);
  if v_target_fiscal_year <> public.service_procurement_fiscal_year((timezone('Asia/Bangkok', now()))::date)
    or v_target_fiscal_year <> v_current_fiscal_year then
    raise exception using errcode = '55000', message = 'service plans may roll over only into the current fiscal year';
  end if;
  if v_source_fiscal_year <> v_target_fiscal_year - 1 then
    raise exception using errcode = '22023', message = 'service plan rollover source must be the previous fiscal year';
  end if;

  perform pg_advisory_xact_lock(hashtext('labcbh_service_plan_rollover'), v_target_fiscal_year);

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item_payload(value)
    where jsonb_typeof(item_payload.value) <> 'object'
      or coalesce(item_payload.value ->> 'sourcePlanId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(item_payload.value ->> 'budget', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or (item_payload.value ->> 'budget')::numeric <= 0
      or coalesce(item_payload.value ->> 'expectedUpdatedAt', '') = ''
      or jsonb_typeof(item_payload.value -> 'responsibleProfileIds') <> 'array'
  ) then
    raise exception using errcode = '22023', message = 'service plan rollover item is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item_payload(value)
    group by item_payload.value ->> 'sourcePlanId'
    having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'service plan rollover contains a duplicate source plan';
  end if;

  select count(*) into v_source_count
  from public.service_procurement_plans as plan
  where plan.fiscal_year = v_source_fiscal_year
    and not exists (
      select 1
      from public.service_procurement_plans as copied_plan
      where copied_plan.rollover_source_plan_id = plan.id
        and copied_plan.fiscal_year = v_target_fiscal_year
    );
  v_selected_count := jsonb_array_length(p_items);
  v_excluded_count := greatest(v_source_count - v_selected_count, 0);

  for payload_item in
    select item_payload.value
    from jsonb_array_elements(p_items) as item_payload(value)
  loop
    select plan.* into source_plan
    from public.service_procurement_plans as plan
    where plan.id = (payload_item ->> 'sourcePlanId')::uuid
      and plan.fiscal_year = v_source_fiscal_year
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'service plan rollover source was not found in the previous fiscal year';
    end if;

    if source_plan.updated_at is distinct from (payload_item ->> 'expectedUpdatedAt')::timestamptz then
      raise exception using errcode = '40001', message = 'service plan changed during rollover review; reload and review again';
    end if;

    perform profile.id
    from public.service_plan_responsibles as responsible
    join public.profiles as profile on profile.id = responsible.profile_id
    where responsible.plan_id = source_plan.id
    for share of profile;

    select coalesce(array_agg(profile.id order by profile.id), '{}'::uuid[]) into v_active_profile_ids
    from public.service_plan_responsibles as responsible
    join public.profiles as profile on profile.id = responsible.profile_id
    where responsible.plan_id = source_plan.id
      and profile.status = 'active'
      and profile.deleted_at is null;
    select coalesce(array_agg(profile_id order by profile_id), '{}'::uuid[]) into v_expected_profile_ids
    from (
      select expected_profile.value::uuid as profile_id
      from jsonb_array_elements_text(payload_item -> 'responsibleProfileIds') as expected_profile(value)
    ) as expected_profiles;
    if v_active_profile_ids is distinct from v_expected_profile_ids then
      raise exception using errcode = '40001', message = 'service plan responsibles changed during rollover review; reload and review again';
    end if;

    if exists (
      select 1
      from public.service_procurement_plans as target_plan
      where target_plan.rollover_source_plan_id = source_plan.id
        and target_plan.fiscal_year = v_target_fiscal_year
    ) then
      raise exception using errcode = '23505', message = 'service plan was already rolled over into this fiscal year';
    end if;

    v_budget := (payload_item ->> 'budget')::numeric(17,2);
    insert into public.service_procurement_plans (
      fiscal_year,
      name,
      department,
      plan_type,
      budget,
      is_red_cross,
      requires_contract,
      status,
      rollover_source_plan_id,
      created_by,
      updated_by
    ) values (
      v_target_fiscal_year,
      source_plan.name,
      source_plan.department,
      source_plan.plan_type,
      v_budget,
      source_plan.is_red_cross,
      source_plan.requires_contract,
      'active',
      source_plan.id,
      p_actor_id,
      p_actor_id
    ) returning * into created_plan;

    insert into public.service_plan_test_items (
      plan_id,
      line_number,
      name,
      unit,
      unit_price
    )
    select
      created_plan.id,
      source_item.line_number,
      source_item.name,
      source_item.unit,
      source_item.unit_price
    from public.service_plan_test_items as source_item
    where source_item.plan_id = source_plan.id
    order by source_item.line_number;

    insert into public.service_plan_responsibles (plan_id, profile_id, assigned_by)
    select created_plan.id, responsible.profile_id, p_actor_id
    from public.service_plan_responsibles as responsible
    join public.profiles as profile on profile.id = responsible.profile_id
    where responsible.plan_id = source_plan.id
      and profile.status = 'active'
      and profile.deleted_at is null;

    insert into public.service_plan_responsible_audit (plan_id, profile_id, action, actor_id)
    select created_plan.id, responsible.profile_id, 'added', p_actor_id
    from public.service_plan_responsibles as responsible
    where responsible.plan_id = created_plan.id;

    v_created_plan_ids := array_append(v_created_plan_ids, created_plan.id);
  end loop;

  -- Old plans stop accepting work immediately. The existing lifecycle job
  -- closes each plan after its pending/confirmed PR and PO work is finished.
  update public.service_procurement_plans as source_plan_update
  set status = 'closing', updated_by = p_actor_id, updated_at = now()
  where source_plan_update.fiscal_year = v_source_fiscal_year
    and source_plan_update.status = 'active';

  insert into public.service_plan_rollover_runs (
    source_fiscal_year,
    target_fiscal_year,
    selected_count,
    excluded_count,
    actor_id
  ) values (
    v_source_fiscal_year,
    v_target_fiscal_year,
    v_selected_count,
    v_excluded_count,
    p_actor_id
  ) returning id into v_run_id;

  return jsonb_build_object(
    'runId', v_run_id,
    'sourceFiscalYear', v_source_fiscal_year,
    'targetFiscalYear', v_target_fiscal_year,
    'createdPlanIds', to_jsonb(v_created_plan_ids),
    'selectedCount', v_selected_count,
    'excludedCount', v_excluded_count
  );
end
$function$;

revoke execute on function public.rollover_service_procurement_plans(uuid, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.rollover_service_procurement_plans(uuid, integer, integer, jsonb) to service_role;

commit;
