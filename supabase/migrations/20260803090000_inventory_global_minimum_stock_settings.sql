begin;

-- A single system-wide reserve-months value now drives every item's suggested
-- minimum stock. The per-item minimum_stock_months column on inventory_items
-- stays untouched (forward-only) but the app no longer reads or writes it for
-- the suggested-minimum calculation; only the per-item override still varies
-- by item, through the existing set_inventory_minimum_stock RPC.
create table if not exists public.inventory_minimum_stock_settings (
  id boolean primary key default true,
  minimum_stock_months numeric(6,2) not null default 1.5 check (minimum_stock_months > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint inventory_minimum_stock_settings_singleton check (id)
);

insert into public.inventory_minimum_stock_settings (id, minimum_stock_months)
values (true, 1.5)
on conflict (id) do nothing;

alter table public.inventory_minimum_stock_settings enable row level security;

revoke all on table public.inventory_minimum_stock_settings from public, anon, authenticated;
grant select on table public.inventory_minimum_stock_settings to authenticated;
grant select, insert, update, delete on table public.inventory_minimum_stock_settings to service_role;

-- Every stock-app member reads the effective setting; only admins may change
-- it, enforced by the app layer before it calls the service-role function
-- below (the same trust boundary set_inventory_minimum_stock already relies
-- on for per-item changes).
drop policy if exists inventory_minimum_stock_settings_app_read on public.inventory_minimum_stock_settings;
create policy inventory_minimum_stock_settings_app_read
on public.inventory_minimum_stock_settings for select
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
      and profile.ephis_id = '9495'
  )
);

create or replace function public.set_inventory_minimum_stock_months(
  p_actor_id uuid,
  p_minimum_stock_months numeric
)
returns public.inventory_minimum_stock_settings
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.inventory_minimum_stock_settings;
begin
  if p_minimum_stock_months is null or p_minimum_stock_months <= 0 then
    raise exception using
      errcode = '23514',
      message = 'minimum stock months must be greater than zero';
  end if;

  update public.inventory_minimum_stock_settings
  set minimum_stock_months = p_minimum_stock_months,
      updated_at = now(),
      updated_by = p_actor_id
  where id = true
  returning * into updated;

  if updated.id is null then
    raise exception using errcode = 'P0002', message = 'inventory minimum stock settings row is missing';
  end if;

  return updated;
end
$function$;

revoke execute on function public.set_inventory_minimum_stock_months(uuid, numeric) from public;
revoke execute on function public.set_inventory_minimum_stock_months(uuid, numeric) from anon;
revoke execute on function public.set_inventory_minimum_stock_months(uuid, numeric) from authenticated;
grant execute on function public.set_inventory_minimum_stock_months(uuid, numeric) to service_role;

commit;
