begin;

-- A stock check is an auditable event, not a mutable flag. The current week's
-- state is derived from the latest event and its Bangkok week_start, so the
-- checkbox resets without deleting the history.
create table if not exists public.inventory_stock_checks (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  checked_at timestamptz not null default now(),
  week_start date not null,
  checked_by uuid not null references public.profiles(id) on delete restrict
);

create index if not exists inventory_stock_checks_item_checked_at_idx
  on public.inventory_stock_checks (inventory_item_id, checked_at desc, id desc);
create index if not exists inventory_stock_checks_week_start_idx
  on public.inventory_stock_checks (week_start, inventory_item_id);

drop trigger if exists inventory_stock_checks_append_only on public.inventory_stock_checks;
create trigger inventory_stock_checks_append_only
before update or delete on public.inventory_stock_checks
for each row execute function public.prevent_append_only_mutation();

-- One row per item is enough for catalogue/detail reads while retaining the
-- complete event table for audit and future history views.
create or replace view public.inventory_item_latest_stock_checks
with (security_invoker = true) as
select distinct on (check_event.inventory_item_id)
  check_event.inventory_item_id,
  check_event.checked_at,
  check_event.week_start
from public.inventory_stock_checks check_event
order by check_event.inventory_item_id, check_event.checked_at desc, check_event.id desc;

revoke all on table public.inventory_stock_checks from anon, authenticated;
grant select on table public.inventory_stock_checks to authenticated;
grant select, insert, update, delete on table public.inventory_stock_checks to service_role;

revoke all on public.inventory_item_latest_stock_checks from anon, authenticated;
grant select on public.inventory_item_latest_stock_checks to authenticated;
grant select on public.inventory_item_latest_stock_checks to service_role;

alter table public.inventory_stock_checks enable row level security;

drop policy if exists inventory_stock_checks_app_read on public.inventory_stock_checks;
create policy inventory_stock_checks_app_read
on public.inventory_stock_checks for select
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

create or replace function public.record_inventory_stock_check(
  p_inventory_item_id uuid,
  p_actor_id uuid
)
returns public.inventory_stock_checks
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_item_id uuid;
  locked_item_active boolean;
  current_balance numeric(15,3);
  current_week_start date;
  inserted public.inventory_stock_checks;
begin
  if p_actor_id is null then
    raise exception using errcode = '22004', message = 'stock check actor is required';
  end if;

  select item.id, item.is_active
  into locked_item_id, locked_item_active
  from public.inventory_items item
  where item.id = p_inventory_item_id
  for update;

  if locked_item_id is null then
    raise exception using errcode = '23503', message = 'inventory item does not exist';
  end if;

  if not locked_item_active then
    raise exception using errcode = '23514', message = 'inventory item is inactive';
  end if;

  select coalesce(sum(movement.quantity), 0)::numeric(15,3)
  into current_balance
  from public.stock_movements movement
  where movement.inventory_item_id = p_inventory_item_id;

  if current_balance <= 0 then
    raise exception using errcode = '23514', message = 'inventory item has no stock to check';
  end if;

  current_week_start := date_trunc('week', public.lab_stock_today()::timestamp)::date;

  insert into public.inventory_stock_checks (
    inventory_item_id,
    checked_at,
    week_start,
    checked_by
  )
  values (
    p_inventory_item_id,
    now(),
    current_week_start,
    p_actor_id
  )
  returning * into inserted;

  return inserted;
end
$function$;

revoke execute on function public.record_inventory_stock_check(uuid, uuid) from public;
revoke execute on function public.record_inventory_stock_check(uuid, uuid) from anon;
revoke execute on function public.record_inventory_stock_check(uuid, uuid) from authenticated;
grant execute on function public.record_inventory_stock_check(uuid, uuid) to service_role;

commit;
