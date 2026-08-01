-- Retire the reporting-only role from active memberships while keeping audit
-- rows intact so past permission changes remain traceable.
begin;

delete from public.lab_stock_memberships
where role = 'reporter';

alter table public.lab_stock_memberships
  drop constraint if exists lab_stock_memberships_role_check;

alter table public.lab_stock_memberships
  add constraint lab_stock_memberships_role_check
  check (role in ('admin', 'head', 'stock_officer', 'viewer'));

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

  if p_role not in ('admin', 'head', 'stock_officer', 'viewer') then
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

commit;
