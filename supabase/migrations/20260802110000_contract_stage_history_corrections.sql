begin;

-- The original workflow log is append-only. Corrections are stored separately
-- so the initially recorded date and every later correction remain auditable.
create table if not exists public.contract_stage_history_corrections (
  id uuid primary key default gen_random_uuid(),
  history_id uuid not null references public.contract_stage_history(id) on delete restrict,
  effective_date date not null,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists contract_stage_history_corrections_history_created_idx
  on public.contract_stage_history_corrections(history_id, created_at desc);

alter table public.contract_stage_history_corrections enable row level security;
revoke all on table public.contract_stage_history_corrections from public, anon, authenticated;
grant select, insert on table public.contract_stage_history_corrections to service_role;
grant select on table public.contract_stage_history_corrections to authenticated;

create policy contract_stage_history_corrections_app_read
on public.contract_stage_history_corrections for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and profile.status = 'active'
      and profile.deleted_at is null
  )
);

create or replace function public.correct_contract_stage_history(
  p_history_id uuid,
  p_actor_id uuid,
  p_effective_date date,
  p_reason text
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_history public.contract_stage_history%rowtype;
  target_contract public.contracts%rowtype;
  normalized_reason text;
begin
  perform public.assert_stock_officer_actor(p_actor_id);
  normalized_reason := nullif(btrim(p_reason), '');
  if p_effective_date is null or normalized_reason is null then
    raise exception using errcode = '22023', message = 'effective date and correction reason are required';
  end if;

  select history.* into target_history
  from public.contract_stage_history history
  where history.id = p_history_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contract stage history not found';
  end if;

  select contract.* into target_contract
  from public.contracts contract
  where contract.id = target_history.contract_id
    and not coalesce(contract.is_archived, false)
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active contract not found';
  end if;

  insert into public.contract_stage_history_corrections (history_id, effective_date, reason, actor_id)
  values (p_history_id, p_effective_date, normalized_reason, p_actor_id);

  return target_contract;
end
$function$;

create or replace function public.backfill_contract_stage_history(
  p_contract_id bigint,
  p_actor_id uuid,
  p_to_stage text,
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
  from_stage_value text;
  stages text[] := array[
    'sent_to_procurement', 'plan_published', 'tender_announced',
    'result_consideration', 'winner_announced', 'contract_started'
  ];
begin
  perform public.assert_stock_officer_actor(p_actor_id);
  normalized_note := nullif(btrim(p_note), '');
  if p_effective_date is null or normalized_note is null or p_to_stage is null or not (p_to_stage = any(stages)) then
    raise exception using errcode = '22023', message = 'valid stage, effective date, and note are required';
  end if;

  select contract.* into target_contract
  from public.contracts contract
  where contract.id = p_contract_id
    and not coalesce(contract.is_archived, false)
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active contract not found';
  end if;
  if target_contract.procurement_stage is null
    or array_position(stages, p_to_stage) > array_position(stages, target_contract.procurement_stage) then
    raise exception using errcode = '22023', message = 'cannot backfill a future contract stage';
  end if;
  if exists (select 1 from public.contract_stage_history where contract_id = p_contract_id and to_stage = p_to_stage) then
    raise exception using errcode = '23505', message = 'contract stage history already exists';
  end if;

  from_stage_value := case p_to_stage
    when 'plan_published' then 'sent_to_procurement'
    when 'tender_announced' then 'plan_published'
    when 'result_consideration' then 'tender_announced'
    when 'winner_announced' then 'result_consideration'
    when 'contract_started' then 'winner_announced'
    else null
  end;

  insert into public.contract_stage_history (
    contract_id, from_stage, to_stage, effective_date, contract_number_snapshot, note, source, actor_id
  ) values (
    p_contract_id, from_stage_value, p_to_stage, p_effective_date,
    case when p_to_stage = 'contract_started' then target_contract.contract_number else null end,
    normalized_note, 'labcbh_stock', p_actor_id
  );

  return target_contract;
end
$function$;

revoke execute on function public.correct_contract_stage_history(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.correct_contract_stage_history(uuid, uuid, date, text) to service_role;
revoke execute on function public.backfill_contract_stage_history(bigint, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.backfill_contract_stage_history(bigint, uuid, text, date, text) to service_role;

commit;
