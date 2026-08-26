-- LABCBH Stock — allow stock officers to maintain non-admin memberships.
-- The database remains the authority: a stock officer can manage head,
-- stock_officer, and viewer, but only an administrator can grant admin.
begin;

create or replace function public.assert_lab_stock_membership_manager(p_actor_id uuid)
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
            and membership.role in ('admin', 'stock_officer')
        )
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'actor is not allowed to manage memberships';
  end if;
end
$function$;

revoke execute on function public.assert_lab_stock_membership_manager(uuid) from public;
revoke execute on function public.assert_lab_stock_membership_manager(uuid) from anon;
revoke execute on function public.assert_lab_stock_membership_manager(uuid) from authenticated;
grant execute on function public.assert_lab_stock_membership_manager(uuid) to service_role;

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
  perform public.assert_lab_stock_membership_manager(p_actor_id);

  if p_role not in ('admin', 'head', 'stock_officer', 'viewer') then
    raise exception using errcode = '23514', message = 'unknown lab stock role';
  end if;

  -- A stock officer may maintain operational roles, never escalate another
  -- profile to administrator. The intrinsic e-Phis administrator also passes
  -- the administrator gate and can manage every role.
  if p_role = 'admin' then
    perform public.assert_lab_stock_admin_actor(p_actor_id);
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

revoke execute on function public.set_lab_stock_membership(uuid, uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.set_lab_stock_membership(uuid, uuid, text, boolean, text)
  to service_role;

commit;
