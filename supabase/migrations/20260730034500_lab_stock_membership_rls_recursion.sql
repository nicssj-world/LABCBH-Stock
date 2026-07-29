-- Resolve membership roles without recursively invoking membership RLS.

begin;

create or replace function public.is_current_lab_stock_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles profile
    left join public.lab_stock_memberships membership
      on membership.profile_id = profile.id
      and membership.active
      and membership.role = 'admin'
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.ephis_id = '9495'
        or membership.id is not null
      )
  );
$function$;

revoke execute on function public.is_current_lab_stock_admin() from public;
revoke execute on function public.is_current_lab_stock_admin() from anon;
grant execute on function public.is_current_lab_stock_admin() to authenticated;
grant execute on function public.is_current_lab_stock_admin() to service_role;

drop policy if exists lab_stock_memberships_admin_read_all on public.lab_stock_memberships;
drop policy if exists lab_stock_memberships_self_or_admin_read on public.lab_stock_memberships;

create policy lab_stock_memberships_self_or_admin_read
on public.lab_stock_memberships for select
to authenticated
using (
  public.is_current_lab_stock_admin()
  or (
    profile_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.status = 'active'
        and profile.deleted_at is null
    )
  )
);

commit;
