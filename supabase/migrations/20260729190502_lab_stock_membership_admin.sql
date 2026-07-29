-- LABCBH Stock — administered app memberships.
--
-- Who can do what is configurable at runtime rather than hard-coded, but every
-- change is audited and only an administrator can make one. The admin gate
-- lives in the database so a mistake in a Server Action cannot widen access.

begin;

create table if not exists public.lab_stock_membership_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  role text not null check (role in ('admin', 'head', 'stock_officer', 'viewer', 'reporter')),
  previous_active boolean,
  next_active boolean not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists lab_stock_membership_audit_profile_idx
  on public.lab_stock_membership_audit (profile_id, created_at desc);
create index if not exists lab_stock_membership_audit_actor_idx
  on public.lab_stock_membership_audit (actor_id) where actor_id is not null;

drop trigger if exists lab_stock_membership_audit_append_only on public.lab_stock_membership_audit;
create trigger lab_stock_membership_audit_append_only
before update or delete on public.lab_stock_membership_audit
for each row execute function public.prevent_append_only_mutation();

-- Deliberately narrower than assert_contract_editor_actor: heads and stock
-- officers run the workflow, but only an administrator changes who may.
create or replace function public.assert_lab_stock_admin_actor(p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
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
      message = 'actor is not allowed to administer memberships';
  end if;
end
$function$;

revoke execute on function public.assert_lab_stock_admin_actor(uuid) from public;
revoke execute on function public.assert_lab_stock_admin_actor(uuid) from anon;
revoke execute on function public.assert_lab_stock_admin_actor(uuid) from authenticated;
grant execute on function public.assert_lab_stock_admin_actor(uuid) to service_role;

create or replace function public.set_lab_stock_membership(
  p_profile_id uuid,
  p_actor_id uuid,
  p_role text,
  p_active boolean,
  p_note text default null
)
returns public.lab_stock_memberships
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous_membership public.lab_stock_memberships%rowtype;
  updated_membership public.lab_stock_memberships%rowtype;
begin
  perform public.assert_lab_stock_admin_actor(p_actor_id);

  if p_role not in ('admin', 'head', 'stock_officer', 'viewer', 'reporter') then
    raise exception using errcode = '23514', message = 'unknown lab stock role';
  end if;

  if p_active is null then
    raise exception using errcode = '23514', message = 'membership active flag is required';
  end if;

  if not exists (
    select 1 from public.profiles profile where profile.id = p_profile_id
  ) then
    raise exception using errcode = '23503', message = 'profile not found';
  end if;

  select *
  into previous_membership
  from public.lab_stock_memberships membership
  where membership.profile_id = p_profile_id
    and membership.role = p_role
  for update;

  insert into public.lab_stock_memberships (profile_id, role, active, granted_by, updated_by)
  values (p_profile_id, p_role, p_active, p_actor_id, p_actor_id)
  on conflict (profile_id, role) do update
    set active = excluded.active,
        updated_by = p_actor_id
  returning * into updated_membership;

  insert into public.lab_stock_membership_audit (
    profile_id,
    actor_id,
    role,
    previous_active,
    next_active,
    note
  )
  values (
    p_profile_id,
    p_actor_id,
    p_role,
    previous_membership.active,
    updated_membership.active,
    nullif(btrim(coalesce(p_note, '')), '')
  );

  return updated_membership;
end
$function$;

revoke execute on function public.set_lab_stock_membership(uuid, uuid, text, boolean, text) from public;
revoke execute on function public.set_lab_stock_membership(uuid, uuid, text, boolean, text) from anon;
revoke execute on function public.set_lab_stock_membership(uuid, uuid, text, boolean, text) from authenticated;
grant execute on function public.set_lab_stock_membership(uuid, uuid, text, boolean, text) to service_role;

alter table public.lab_stock_membership_audit enable row level security;

revoke all on table public.lab_stock_membership_audit from anon, authenticated;
grant select on table public.lab_stock_membership_audit to authenticated;
grant select, insert, update, delete on table public.lab_stock_membership_audit to service_role;

drop policy if exists lab_stock_membership_audit_admin_read on public.lab_stock_membership_audit;
create policy lab_stock_membership_audit_admin_read
on public.lab_stock_membership_audit for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships admin_membership
    join public.profiles admin_profile on admin_profile.id = admin_membership.profile_id
    where admin_membership.profile_id = (select auth.uid())
      and admin_membership.active
      and admin_membership.role = 'admin'
      and admin_profile.status = 'active'
      and admin_profile.deleted_at is null
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and profile.ephis_id = '9495'
  )
);

-- Administering memberships means reading every profile, not only one's own.
drop policy if exists lab_stock_memberships_admin_read_all on public.lab_stock_memberships;
create policy lab_stock_memberships_admin_read_all
on public.lab_stock_memberships for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships admin_membership
    join public.profiles admin_profile on admin_profile.id = admin_membership.profile_id
    where admin_membership.profile_id = (select auth.uid())
      and admin_membership.active
      and admin_membership.role = 'admin'
      and admin_profile.status = 'active'
      and admin_profile.deleted_at is null
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and profile.ephis_id = '9495'
  )
);

commit;
