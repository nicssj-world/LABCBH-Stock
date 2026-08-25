-- LABCBH Stock — annual procurement and hiring plan documents.
-- The database keeps exactly one document per plan type and fiscal year. The
-- application removes old Storage objects before hard-deleting their rows.
begin;

create table public.lab_stock_annual_plans (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  plan_type text not null check (plan_type in ('procurement', 'hiring')),
  file_path text not null check (
    file_path like 'annual-plans/%'
    and file_path not like '%..%'
  ),
  file_name text not null check (nullif(btrim(file_name), '') is not null),
  file_mime_type text not null check (lower(file_mime_type) = 'application/pdf'),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 26214400),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_year, plan_type)
);

create index lab_stock_annual_plans_fiscal_year_idx
  on public.lab_stock_annual_plans (fiscal_year desc, plan_type);

create table public.lab_stock_annual_plan_audit (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  fiscal_year integer not null,
  plan_type text not null check (plan_type in ('procurement', 'hiring')),
  action text not null check (action in ('uploaded', 'replaced', 'hard_deleted')),
  file_path text not null,
  file_name text not null,
  file_mime_type text not null,
  file_size_bytes bigint not null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index lab_stock_annual_plan_audit_plan_idx
  on public.lab_stock_annual_plan_audit (plan_id, created_at desc);
create index lab_stock_annual_plan_audit_created_idx
  on public.lab_stock_annual_plan_audit (created_at desc);

drop trigger if exists lab_stock_annual_plan_audit_append_only on public.lab_stock_annual_plan_audit;
create trigger lab_stock_annual_plan_audit_append_only
before update or delete on public.lab_stock_annual_plan_audit
for each row execute function public.prevent_append_only_mutation();

drop trigger if exists lab_stock_annual_plans_set_updated_at on public.lab_stock_annual_plans;
create trigger lab_stock_annual_plans_set_updated_at
before update on public.lab_stock_annual_plans
for each row execute function public.lab_stock_set_updated_at();

-- The bucket is private. Client reads use the table permission plus a signed
-- URL; clients never receive a public object URL.
insert into storage.buckets (id, name, public)
values ('lab-stock-annual-plans', 'lab-stock-annual-plans', false)
on conflict (id) do update set public = false;

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['application/pdf']
where id = 'lab-stock-annual-plans';

alter table public.lab_stock_annual_plans enable row level security;
alter table public.lab_stock_annual_plan_audit enable row level security;

revoke all on table public.lab_stock_annual_plans from anon, authenticated;
grant select on table public.lab_stock_annual_plans to authenticated;
grant select, insert, update, delete on table public.lab_stock_annual_plans to service_role;

revoke all on table public.lab_stock_annual_plan_audit from anon, authenticated;
grant select, insert on table public.lab_stock_annual_plan_audit to service_role;

drop policy if exists lab_stock_annual_plans_app_read on public.lab_stock_annual_plans;
create policy lab_stock_annual_plans_app_read
on public.lab_stock_annual_plans for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (profile.ephis_id = '9495' or profile.role = 'Manager')
  )
);

-- Storage access mirrors the table access. There is intentionally no client
-- delete policy: hard deletion is sequenced by a service-role workflow.
drop policy if exists lab_stock_annual_plans_app_read on storage.objects;
create policy lab_stock_annual_plans_app_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'lab-stock-annual-plans'
  and name not like '%..%'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

drop policy if exists lab_stock_annual_plans_operator_insert on storage.objects;
create policy lab_stock_annual_plans_operator_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'lab-stock-annual-plans'
  and name ~ '^annual-plans/[0-9]{4}/(procurement|hiring)/[^/]+\.pdf$'
  and name not like '%..%'
  and (metadata->>'mimetype') = 'application/pdf'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'stock_officer')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

drop policy if exists lab_stock_annual_plans_operator_update on storage.objects;
create policy lab_stock_annual_plans_operator_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'lab-stock-annual-plans'
  and name not like '%..%'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'stock_officer')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
)
with check (
  bucket_id = 'lab-stock-annual-plans'
  and name ~ '^annual-plans/[0-9]{4}/(procurement|hiring)/[^/]+\.pdf$'
  and name not like '%..%'
  and (metadata->>'mimetype') = 'application/pdf'
);

create or replace function public.upsert_lab_stock_annual_plan(
  p_fiscal_year integer,
  p_plan_type text,
  p_actor_id uuid,
  p_file_path text,
  p_file_name text,
  p_file_mime_type text,
  p_file_size_bytes bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous_plan public.lab_stock_annual_plans%rowtype;
  updated_plan public.lab_stock_annual_plans%rowtype;
  current_fiscal_year integer;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  current_fiscal_year := extract(year from timezone('Asia/Bangkok', now()))::integer
    + case
        when extract(month from timezone('Asia/Bangkok', now())) >= 10 then 544
        else 543
      end;

  if p_fiscal_year not in (current_fiscal_year, current_fiscal_year - 1) then
    raise exception using errcode = '22023', message = 'annual plan fiscal year is outside the retention window';
  end if;
  if p_plan_type not in ('procurement', 'hiring') then
    raise exception using errcode = '23514', message = 'unknown annual plan type';
  end if;
  if nullif(btrim(coalesce(p_file_path, '')), '') is null
     or p_file_path like '%..%'
     or p_file_path !~ format('^annual-plans/%s/%s/[^/]+\.pdf$', p_fiscal_year, p_plan_type) then
    raise exception using errcode = '23514', message = 'annual plan file path is invalid';
  end if;
  if nullif(btrim(coalesce(p_file_name, '')), '') is null then
    raise exception using errcode = '23514', message = 'annual plan file name is required';
  end if;
  if lower(btrim(coalesce(p_file_mime_type, ''))) <> 'application/pdf' then
    raise exception using errcode = '22023', message = 'annual plan file type is not allowed';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes not between 1 and 26214400 then
    raise exception using errcode = '22023', message = 'annual plan file size is not allowed';
  end if;

  -- Serialize the one slot (fiscal year + plan type) so replacing a document
  -- also produces exactly one audit record under concurrent uploads.
  perform pg_advisory_xact_lock(hashtext(format('%s:%s', p_fiscal_year, p_plan_type)));

  select *
  into previous_plan
  from public.lab_stock_annual_plans plan
  where plan.fiscal_year = p_fiscal_year
    and plan.plan_type = p_plan_type
  for update;

  if found then
    insert into public.lab_stock_annual_plan_audit (
      plan_id, fiscal_year, plan_type, action, file_path, file_name,
      file_mime_type, file_size_bytes, actor_id
    ) values (
      previous_plan.id, previous_plan.fiscal_year, previous_plan.plan_type, 'replaced',
      previous_plan.file_path, previous_plan.file_name, previous_plan.file_mime_type,
      previous_plan.file_size_bytes, p_actor_id
    );

    update public.lab_stock_annual_plans
    set file_path = btrim(p_file_path),
        file_name = btrim(p_file_name),
        file_mime_type = lower(btrim(p_file_mime_type)),
        file_size_bytes = p_file_size_bytes,
        uploaded_by = p_actor_id,
        uploaded_at = now()
    where id = previous_plan.id
    returning * into updated_plan;
  else
    insert into public.lab_stock_annual_plans (
      fiscal_year, plan_type, file_path, file_name, file_mime_type,
      file_size_bytes, uploaded_by
    ) values (
      p_fiscal_year, p_plan_type, btrim(p_file_path), btrim(p_file_name),
      lower(btrim(p_file_mime_type)), p_file_size_bytes, p_actor_id
    ) returning * into updated_plan;
  end if;

  insert into public.lab_stock_annual_plan_audit (
    plan_id, fiscal_year, plan_type, action, file_path, file_name,
    file_mime_type, file_size_bytes, actor_id
  ) values (
    updated_plan.id, updated_plan.fiscal_year, updated_plan.plan_type,
    case when previous_plan.id is null then 'uploaded' else 'replaced' end,
    updated_plan.file_path, updated_plan.file_name, updated_plan.file_mime_type,
    updated_plan.file_size_bytes, p_actor_id
  );

  return jsonb_build_object(
    'id', updated_plan.id,
    'fiscal_year', updated_plan.fiscal_year,
    'plan_type', updated_plan.plan_type,
    'file_path', updated_plan.file_path,
    'file_name', updated_plan.file_name,
    'file_mime_type', updated_plan.file_mime_type,
    'file_size_bytes', updated_plan.file_size_bytes,
    'uploaded_by', updated_plan.uploaded_by,
    'uploaded_at', updated_plan.uploaded_at,
    'previous_file_path', case when previous_plan.id is null then null else previous_plan.file_path end
  );
end
$function$;

create or replace function public.list_expired_lab_stock_annual_plans(p_current_fiscal_year integer)
returns table (
  id uuid,
  fiscal_year integer,
  plan_type text,
  file_path text
)
language sql
security invoker
set search_path = ''
as $function$
  select plan.id, plan.fiscal_year, plan.plan_type, plan.file_path
  from public.lab_stock_annual_plans plan
  where plan.fiscal_year < p_current_fiscal_year - 1
  order by plan.fiscal_year asc, plan.plan_type asc
$function$;

create or replace function public.hard_delete_lab_stock_annual_plan(
  p_plan_id uuid,
  p_actor_id uuid,
  p_expected_file_path text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_plan public.lab_stock_annual_plans%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  select *
  into target_plan
  from public.lab_stock_annual_plans plan
  where plan.id = p_plan_id
  for update;

  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'not_found');
  end if;
  if target_plan.file_path <> p_expected_file_path then
    return jsonb_build_object('deleted', false, 'reason', 'file_replaced');
  end if;

  insert into public.lab_stock_annual_plan_audit (
    plan_id, fiscal_year, plan_type, action, file_path, file_name,
    file_mime_type, file_size_bytes, actor_id
  ) values (
    target_plan.id, target_plan.fiscal_year, target_plan.plan_type, 'hard_deleted',
    target_plan.file_path, target_plan.file_name, target_plan.file_mime_type,
    target_plan.file_size_bytes, p_actor_id
  );

  delete from public.lab_stock_annual_plans where id = target_plan.id;
  return jsonb_build_object('deleted', true, 'file_path', target_plan.file_path);
end
$function$;

revoke execute on function public.upsert_lab_stock_annual_plan(integer, text, uuid, text, text, text, bigint)
  from public, anon, authenticated;
revoke execute on function public.list_expired_lab_stock_annual_plans(integer)
  from public, anon, authenticated;
revoke execute on function public.hard_delete_lab_stock_annual_plan(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.upsert_lab_stock_annual_plan(integer, text, uuid, text, text, text, bigint)
  to service_role;
grant execute on function public.list_expired_lab_stock_annual_plans(integer)
  to service_role;
grant execute on function public.hard_delete_lab_stock_annual_plan(uuid, uuid, text)
  to service_role;

commit;
