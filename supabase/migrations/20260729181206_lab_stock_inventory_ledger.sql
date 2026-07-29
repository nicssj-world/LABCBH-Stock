-- LABCBH Stock — inventory catalog, lots, and the immutable stock ledger.
--
-- The governing invariant: no table stores an authoritative balance. On-hand
-- for an item and remaining quantity for a lot are always summed from
-- public.stock_movements, which is append-only and can never drive a balance
-- below zero. Authenticated clients read; every mutation runs through a
-- service-role-only transaction function.

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  ls_code text not null check (nullif(btrim(ls_code), '') is not null),
  name text not null check (nullif(btrim(name), '') is not null),
  base_unit text not null check (nullif(btrim(base_unit), '') is not null),
  responsible_department text,
  default_unit_price numeric(15,2) check (default_unit_price is null or default_unit_price >= 0),
  minimum_stock_months numeric(6,2) not null default 1.5 check (minimum_stock_months > 0),
  minimum_stock_override numeric(15,3) check (
    minimum_stock_override is null or minimum_stock_override >= 0
  ),
  is_active boolean not null default true,
  note text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- Sheet variants such as `ls046022`, `LS 046022`, and `ls-046022` are the same
-- reagent. Identity ignores case and separators; ls_code keeps the display form.
create unique index if not exists inventory_items_ls_code_normalized_key
  on public.inventory_items (upper(regexp_replace(ls_code, '[^a-zA-Z0-9]', '', 'g')));

create table if not exists public.inventory_item_aliases (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  alias_kind text not null default 'name' check (alias_kind in ('name', 'unit', 'ls_code')),
  alias_value text not null check (nullif(btrim(alias_value), '') is not null),
  source text not null default 'legacy_import' check (
    source in ('labcbh_stock', 'legacy_import', 'portal_migration')
  ),
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (inventory_item_id, alias_kind, alias_value)
);

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  -- Task 7 fills this in when receiving posts; opening counts and legacy
  -- imports create lots with no originating receipt line.
  goods_receipt_item_id uuid,
  lot_number text not null check (nullif(btrim(lot_number), '') is not null),
  expiry_date date,
  received_date date not null,
  original_quantity numeric(15,3) not null check (original_quantity > 0),
  storage_location text,
  note text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (inventory_item_id, lot_number)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  inventory_lot_id uuid references public.inventory_lots(id) on delete restrict,
  movement_type text not null check (movement_type in (
    'goods_receipt',
    'requisition_issue',
    'opening_adjustment',
    'manual_adjustment',
    'reversal'
  )),
  quantity numeric(15,3) not null check (quantity <> 0),
  occurred_on date not null default current_date,
  source_document_type text check (source_document_type in (
    'goods_receipt',
    'requisition',
    'opening_count',
    'manual_adjustment',
    'reversal'
  )),
  source_document_id uuid,
  reference_movement_id uuid references public.stock_movements(id) on delete restrict,
  note text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  constraint stock_movements_type_sign_check check (
    (movement_type = 'goods_receipt' and quantity > 0 and inventory_lot_id is not null)
    or (movement_type = 'requisition_issue' and quantity < 0 and inventory_lot_id is not null)
    or (movement_type = 'opening_adjustment' and quantity > 0)
    or (movement_type = 'manual_adjustment')
    or (movement_type = 'reversal' and reference_movement_id is not null)
  ),
  constraint stock_movements_reversal_reference_check check (
    (movement_type = 'reversal') = (reference_movement_id is not null)
  )
);

create table if not exists public.inventory_minimum_stock_audit (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  previous_override numeric(15,3),
  next_override numeric(15,3),
  previous_months numeric(6,2),
  next_months numeric(6,2),
  reason text,
  created_at timestamptz not null default now()
);

-- Re-posting the same source document must be a no-op rather than a duplicate
-- movement. The sentinel keeps lot-less adjustments inside the same guarantee.
create unique index if not exists stock_movements_source_document_key
  on public.stock_movements (
    source_document_type,
    source_document_id,
    inventory_item_id,
    coalesce(inventory_lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where source_document_id is not null;

create unique index if not exists stock_movements_reversal_reference_key
  on public.stock_movements (reference_movement_id)
  where movement_type = 'reversal';

create index if not exists inventory_items_active_department_idx
  on public.inventory_items (is_active, responsible_department);
create index if not exists inventory_items_name_idx
  on public.inventory_items (name);
create index if not exists inventory_items_created_by_idx
  on public.inventory_items (created_by) where created_by is not null;
create index if not exists inventory_items_updated_by_idx
  on public.inventory_items (updated_by) where updated_by is not null;
create index if not exists inventory_item_aliases_item_idx
  on public.inventory_item_aliases (inventory_item_id);
create index if not exists inventory_item_aliases_created_by_idx
  on public.inventory_item_aliases (created_by) where created_by is not null;
create index if not exists inventory_lots_item_expiry_idx
  on public.inventory_lots (inventory_item_id, expiry_date);
create index if not exists inventory_lots_receipt_item_idx
  on public.inventory_lots (goods_receipt_item_id) where goods_receipt_item_id is not null;
create index if not exists inventory_lots_created_by_idx
  on public.inventory_lots (created_by) where created_by is not null;
create index if not exists inventory_lots_updated_by_idx
  on public.inventory_lots (updated_by) where updated_by is not null;
create index if not exists stock_movements_item_idx
  on public.stock_movements (inventory_item_id, occurred_on desc);
create index if not exists stock_movements_lot_idx
  on public.stock_movements (inventory_lot_id) where inventory_lot_id is not null;
create index if not exists stock_movements_created_by_idx
  on public.stock_movements (created_by) where created_by is not null;
create index if not exists stock_movements_reference_movement_idx
  on public.stock_movements (reference_movement_id) where reference_movement_id is not null;
create index if not exists inventory_minimum_stock_audit_item_idx
  on public.inventory_minimum_stock_audit (inventory_item_id, created_at desc);
create index if not exists inventory_minimum_stock_audit_actor_idx
  on public.inventory_minimum_stock_audit (actor_id) where actor_id is not null;

-- Derived balances live in views, never in columns. `security_invoker` keeps
-- every read subject to the same RLS policies as the underlying tables, and
-- aggregating in Postgres stops the app from pulling the whole ledger to add
-- up a single number.
create or replace view public.inventory_item_balances
with (security_invoker = true) as
select
  item.id as inventory_item_id,
  coalesce(sum(movement.quantity), 0)::numeric(15,3) as on_hand
from public.inventory_items item
left join public.stock_movements movement on movement.inventory_item_id = item.id
group by item.id;

create or replace view public.inventory_lot_balances
with (security_invoker = true) as
select
  lot.id as inventory_lot_id,
  lot.inventory_item_id,
  coalesce(sum(movement.quantity), 0)::numeric(15,3) as balance
from public.inventory_lots lot
left join public.stock_movements movement on movement.inventory_lot_id = lot.id
group by lot.id, lot.inventory_item_id;

create or replace view public.inventory_item_monthly_issues
with (security_invoker = true) as
select
  movement.inventory_item_id,
  date_trunc('month', movement.occurred_on)::date as issue_month,
  sum(-movement.quantity)::numeric(15,3) as issued_quantity
from public.stock_movements movement
where movement.movement_type = 'requisition_issue'
group by movement.inventory_item_id, date_trunc('month', movement.occurred_on);

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row execute function public.lab_stock_set_updated_at();

drop trigger if exists inventory_lots_set_updated_at on public.inventory_lots;
create trigger inventory_lots_set_updated_at
before update on public.inventory_lots
for each row execute function public.lab_stock_set_updated_at();

-- The ledger is corrected by compensating rows, never by editing history.
drop trigger if exists stock_movements_append_only on public.stock_movements;
create trigger stock_movements_append_only
before update or delete on public.stock_movements
for each row execute function public.prevent_append_only_mutation();

drop trigger if exists inventory_minimum_stock_audit_append_only on public.inventory_minimum_stock_audit;
create trigger inventory_minimum_stock_audit_append_only
before update or delete on public.inventory_minimum_stock_audit
for each row execute function public.prevent_append_only_mutation();

-- Locking the item row serializes every concurrent movement for that reagent,
-- so two simultaneous issues cannot both read the same pre-issue balance.
create or replace function public.guard_stock_movement_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_item_id uuid;
  lot_item_id uuid;
  lot_balance numeric(15,3);
  item_balance numeric(15,3);
begin
  select item.id into locked_item_id
  from public.inventory_items item
  where item.id = new.inventory_item_id
  for update;

  if locked_item_id is null then
    raise exception using
      errcode = '23503',
      message = 'inventory item does not exist';
  end if;

  if new.inventory_lot_id is not null then
    select lot.inventory_item_id into lot_item_id
    from public.inventory_lots lot
    where lot.id = new.inventory_lot_id
    for update;

    if lot_item_id is null then
      raise exception using
        errcode = '23503',
        message = 'inventory lot does not exist';
    end if;

    if lot_item_id <> new.inventory_item_id then
      raise exception using
        errcode = '23514',
        message = 'lot belongs to a different inventory item';
    end if;

    select coalesce(sum(movement.quantity), 0) into lot_balance
    from public.stock_movements movement
    where movement.inventory_lot_id = new.inventory_lot_id;

    if lot_balance + new.quantity < 0 then
      raise exception using
        errcode = '23514',
        message = format(
          'lot balance cannot go negative (available %s, requested %s)',
          lot_balance,
          abs(new.quantity)
        );
    end if;
  end if;

  select coalesce(sum(movement.quantity), 0) into item_balance
  from public.stock_movements movement
  where movement.inventory_item_id = new.inventory_item_id;

  if item_balance + new.quantity < 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'item on-hand cannot go negative (available %s, requested %s)',
        item_balance,
        abs(new.quantity)
      );
  end if;

  return new;
end
$function$;

revoke execute on function public.guard_stock_movement_balance() from public;
revoke execute on function public.guard_stock_movement_balance() from anon;
revoke execute on function public.guard_stock_movement_balance() from authenticated;

drop trigger if exists stock_movements_guard_balance on public.stock_movements;
create trigger stock_movements_guard_balance
before insert on public.stock_movements
for each row execute function public.guard_stock_movement_balance();

create or replace function public.record_stock_adjustment(
  p_inventory_item_id uuid,
  p_actor_id uuid,
  p_quantity numeric,
  p_reason text,
  p_inventory_lot_id uuid default null,
  p_occurred_on date default null
)
returns public.stock_movements
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  inserted public.stock_movements;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using
      errcode = '23514',
      message = 'stock adjustment requires a reason';
  end if;

  if p_quantity is null or p_quantity = 0 then
    raise exception using
      errcode = '23514',
      message = 'stock adjustment quantity must not be zero';
  end if;

  insert into public.stock_movements (
    inventory_item_id,
    inventory_lot_id,
    movement_type,
    quantity,
    occurred_on,
    source_document_type,
    note,
    created_by
  )
  values (
    p_inventory_item_id,
    p_inventory_lot_id,
    'manual_adjustment',
    p_quantity,
    coalesce(p_occurred_on, current_date),
    'manual_adjustment',
    btrim(p_reason),
    p_actor_id
  )
  returning * into inserted;

  return inserted;
end
$function$;

revoke execute on function public.record_stock_adjustment(uuid, uuid, numeric, text, uuid, date) from public;
revoke execute on function public.record_stock_adjustment(uuid, uuid, numeric, text, uuid, date) from anon;
revoke execute on function public.record_stock_adjustment(uuid, uuid, numeric, text, uuid, date) from authenticated;
grant execute on function public.record_stock_adjustment(uuid, uuid, numeric, text, uuid, date) to service_role;

create or replace function public.set_inventory_minimum_stock(
  p_inventory_item_id uuid,
  p_actor_id uuid,
  p_minimum_stock_override numeric default null,
  p_minimum_stock_months numeric default null,
  p_reason text default null
)
returns public.inventory_items
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_item public.inventory_items;
  updated_item public.inventory_items;
  next_months numeric(6,2);
begin
  select * into current_item
  from public.inventory_items item
  where item.id = p_inventory_item_id
  for update;

  if current_item.id is null then
    raise exception using
      errcode = '23503',
      message = 'inventory item does not exist';
  end if;

  if p_minimum_stock_override is not null and p_minimum_stock_override < 0 then
    raise exception using
      errcode = '23514',
      message = 'minimum stock override cannot be negative';
  end if;

  next_months := coalesce(p_minimum_stock_months, current_item.minimum_stock_months);

  if next_months <= 0 then
    raise exception using
      errcode = '23514',
      message = 'minimum stock months must be greater than zero';
  end if;

  update public.inventory_items
  set minimum_stock_override = p_minimum_stock_override,
      minimum_stock_months = next_months,
      updated_by = p_actor_id
  where id = p_inventory_item_id
  returning * into updated_item;

  insert into public.inventory_minimum_stock_audit (
    inventory_item_id,
    actor_id,
    previous_override,
    next_override,
    previous_months,
    next_months,
    reason
  )
  values (
    p_inventory_item_id,
    p_actor_id,
    current_item.minimum_stock_override,
    updated_item.minimum_stock_override,
    current_item.minimum_stock_months,
    updated_item.minimum_stock_months,
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  return updated_item;
end
$function$;

revoke execute on function public.set_inventory_minimum_stock(uuid, uuid, numeric, numeric, text) from public;
revoke execute on function public.set_inventory_minimum_stock(uuid, uuid, numeric, numeric, text) from anon;
revoke execute on function public.set_inventory_minimum_stock(uuid, uuid, numeric, numeric, text) from authenticated;
grant execute on function public.set_inventory_minimum_stock(uuid, uuid, numeric, numeric, text) to service_role;

alter table public.inventory_items enable row level security;
alter table public.inventory_item_aliases enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.stock_movements enable row level security;
alter table public.inventory_minimum_stock_audit enable row level security;

revoke all on table public.inventory_items from anon, authenticated;
revoke all on table public.inventory_item_aliases from anon, authenticated;
revoke all on table public.inventory_lots from anon, authenticated;
revoke all on table public.stock_movements from anon, authenticated;
revoke all on table public.inventory_minimum_stock_audit from anon, authenticated;

-- Authenticated clients have SELECT-only access; adjustments and minimum-stock
-- changes run through the service-role functions above.
grant select on table public.inventory_items to authenticated;
grant select on table public.inventory_item_aliases to authenticated;
grant select on table public.inventory_lots to authenticated;
grant select on table public.stock_movements to authenticated;
grant select on table public.inventory_minimum_stock_audit to authenticated;

grant select, insert, update, delete on table public.inventory_items to service_role;
grant select, insert, update, delete on table public.inventory_item_aliases to service_role;
grant select, insert, update, delete on table public.inventory_lots to service_role;
grant select, insert, update, delete on table public.stock_movements to service_role;
grant select, insert, update, delete on table public.inventory_minimum_stock_audit to service_role;

revoke all on public.inventory_item_balances from anon, authenticated;
revoke all on public.inventory_lot_balances from anon, authenticated;
revoke all on public.inventory_item_monthly_issues from anon, authenticated;
grant select on public.inventory_item_balances to authenticated;
grant select on public.inventory_lot_balances to authenticated;
grant select on public.inventory_item_monthly_issues to authenticated;
grant select on public.inventory_item_balances to service_role;
grant select on public.inventory_lot_balances to service_role;
grant select on public.inventory_item_monthly_issues to service_role;

-- Minimum-stock history is an administrative audit trail, so it is scoped to
-- admins rather than every stock reader. Its distinct alias keeps the shared
-- membership predicate below unambiguous.
drop policy if exists inventory_minimum_stock_audit_admin_read on public.inventory_minimum_stock_audit;
create policy inventory_minimum_stock_audit_admin_read
on public.inventory_minimum_stock_audit for select
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

drop policy if exists inventory_items_app_read on public.inventory_items;
create policy inventory_items_app_read
on public.inventory_items for select
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

drop policy if exists inventory_item_aliases_app_read on public.inventory_item_aliases;
create policy inventory_item_aliases_app_read
on public.inventory_item_aliases for select
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

drop policy if exists inventory_lots_app_read on public.inventory_lots;
create policy inventory_lots_app_read
on public.inventory_lots for select
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

drop policy if exists stock_movements_app_read on public.stock_movements;
create policy stock_movements_app_read
on public.stock_movements for select
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
