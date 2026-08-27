begin;

-- A weekly stock check is recorded for the physical lot that was inspected.
-- The original inventory_stock_checks table remains as a legacy item-level
-- audit trail; new checklist work uses this table so a multi-lot item cannot
-- be completed by checking only one parent row.
create table if not exists public.inventory_lot_stock_checks (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  inventory_lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  checked_at timestamptz not null default now(),
  week_start date not null,
  checked_by uuid not null references public.profiles(id) on delete restrict
);

create index if not exists inventory_lot_stock_checks_lot_checked_at_idx
  on public.inventory_lot_stock_checks (inventory_lot_id, checked_at desc, id desc);
create index if not exists inventory_lot_stock_checks_item_week_idx
  on public.inventory_lot_stock_checks (inventory_item_id, week_start, inventory_lot_id);

drop trigger if exists inventory_lot_stock_checks_append_only on public.inventory_lot_stock_checks;
create trigger inventory_lot_stock_checks_append_only
before update or delete on public.inventory_lot_stock_checks
for each row execute function public.prevent_append_only_mutation();

create or replace view public.inventory_lot_latest_stock_checks
with (security_invoker = true) as
select distinct on (check_event.inventory_lot_id)
  check_event.inventory_lot_id,
  check_event.inventory_item_id,
  check_event.checked_at,
  check_event.week_start
from public.inventory_lot_stock_checks check_event
order by check_event.inventory_lot_id, check_event.checked_at desc, check_event.id desc;

revoke all on table public.inventory_lot_stock_checks from anon, authenticated;
grant select on table public.inventory_lot_stock_checks to authenticated;
grant select, insert, update, delete on table public.inventory_lot_stock_checks to service_role;

revoke all on public.inventory_lot_latest_stock_checks from anon, authenticated;
grant select on public.inventory_lot_latest_stock_checks to authenticated;
grant select on public.inventory_lot_latest_stock_checks to service_role;

alter table public.inventory_lot_stock_checks enable row level security;

drop policy if exists inventory_lot_stock_checks_app_read on public.inventory_lot_stock_checks;
create policy inventory_lot_stock_checks_app_read
on public.inventory_lot_stock_checks for select
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

-- The item-level status consumed by the catalogue and detail pages now means
-- "all active lots with a positive balance were checked this week" whenever
-- the item has lot-based stock. Lot-less legacy stock keeps its old fallback.
create or replace view public.inventory_item_latest_stock_checks
with (security_invoker = true) as
with positive_lots as (
  select
    lot.inventory_item_id,
    lot.id as inventory_lot_id
  from public.inventory_lots lot
  join public.inventory_lot_balances lot_balance
    on lot_balance.inventory_lot_id = lot.id
  where lot.is_active
    and lot_balance.balance > 0
),
latest_lot_checks as (
  select distinct on (check_event.inventory_lot_id)
    check_event.inventory_lot_id,
    check_event.checked_at,
    check_event.week_start
  from public.inventory_lot_stock_checks check_event
  order by check_event.inventory_lot_id, check_event.checked_at desc, check_event.id desc
),
lot_summary as (
  select
    positive_lot.inventory_item_id,
    max(latest.checked_at) as checked_at,
    case
      when count(*) > 0
        and count(*) filter (
          where latest.inventory_lot_id is not null
            and latest.week_start = date_trunc('week', public.lab_stock_today()::timestamp)::date
        ) = count(*)
        then date_trunc('week', public.lab_stock_today()::timestamp)::date
      else null::date
    end as week_start
  from positive_lots positive_lot
  left join latest_lot_checks latest
    on latest.inventory_lot_id = positive_lot.inventory_lot_id
  group by positive_lot.inventory_item_id
),
legacy_latest as (
  select distinct on (check_event.inventory_item_id)
    check_event.inventory_item_id,
    check_event.checked_at,
    check_event.week_start
  from public.inventory_stock_checks check_event
  order by check_event.inventory_item_id, check_event.checked_at desc, check_event.id desc
)
select
  summary.inventory_item_id,
  summary.checked_at,
  summary.week_start
from lot_summary summary
union all
select
  legacy.inventory_item_id,
  legacy.checked_at,
  legacy.week_start
from legacy_latest legacy
where not exists (
  select 1
  from lot_summary summary
  where summary.inventory_item_id = legacy.inventory_item_id
);

create or replace function public.record_inventory_lot_stock_check(
  p_inventory_item_id uuid,
  p_inventory_lot_id uuid,
  p_actor_id uuid
)
returns public.inventory_lot_stock_checks
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_item_id uuid;
  locked_item_active boolean;
  locked_lot_id uuid;
  locked_lot_item_id uuid;
  locked_lot_active boolean;
  current_lot_balance numeric(15,3);
  current_week_start date;
  inserted public.inventory_lot_stock_checks;
begin
  if p_actor_id is null then
    raise exception using errcode = '22004', message = 'lot stock check actor is required';
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

  select lot.id, lot.inventory_item_id, lot.is_active
  into locked_lot_id, locked_lot_item_id, locked_lot_active
  from public.inventory_lots lot
  where lot.id = p_inventory_lot_id
  for update;

  if locked_lot_id is null then
    raise exception using errcode = '23503', message = 'inventory lot does not exist';
  end if;

  if locked_lot_item_id <> locked_item_id then
    raise exception using errcode = '23514', message = 'inventory lot does not belong to inventory item';
  end if;

  if not locked_lot_active then
    raise exception using errcode = '23514', message = 'inventory lot is inactive';
  end if;

  select coalesce(sum(movement.quantity), 0)::numeric(15,3)
  into current_lot_balance
  from public.stock_movements movement
  where movement.inventory_lot_id = p_inventory_lot_id;

  if current_lot_balance <= 0 then
    raise exception using errcode = '23514', message = 'inventory lot has no stock to check';
  end if;

  current_week_start := date_trunc('week', public.lab_stock_today()::timestamp)::date;

  insert into public.inventory_lot_stock_checks (
    inventory_item_id,
    inventory_lot_id,
    checked_at,
    week_start,
    checked_by
  )
  values (
    p_inventory_item_id,
    p_inventory_lot_id,
    now(),
    current_week_start,
    p_actor_id
  )
  returning * into inserted;

  return inserted;
end
$function$;

revoke execute on function public.record_inventory_lot_stock_check(uuid, uuid, uuid) from public;
revoke execute on function public.record_inventory_lot_stock_check(uuid, uuid, uuid) from anon;
revoke execute on function public.record_inventory_lot_stock_check(uuid, uuid, uuid) from authenticated;
grant execute on function public.record_inventory_lot_stock_check(uuid, uuid, uuid) to service_role;

commit;
