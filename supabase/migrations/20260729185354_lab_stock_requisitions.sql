-- LABCBH Stock — requisitions, FIFO fulfilment, and the issue ledger.
--
-- A requisition is a request until a stock officer picks the actual lots.
-- Fulfilment is one transaction that locks the requisition, locks every chosen
-- lot, refuses expired lots and short issues, writes one negative movement per
-- allocation, and marks the request fulfilled exactly once.

begin;

create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  sequence_number integer not null check (sequence_number > 0),
  document_number text not null check (nullif(btrim(document_number), '') is not null),
  requester_id uuid references public.profiles(id) on delete restrict,
  -- Snapshot: the printed form must still name the requester years later.
  requester_name text not null check (nullif(btrim(requester_name), '') is not null),
  department text not null check (nullif(btrim(department), '') is not null),
  desired_date date not null,
  status text not null default 'waiting' check (status in ('waiting', 'fulfilled', 'cancelled')),
  note text,
  fulfilled_by uuid references public.profiles(id) on delete restrict,
  fulfilled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancellation_reason text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (fiscal_year, sequence_number),
  constraint requisitions_fulfilled_check check (
    (status = 'fulfilled') = (fulfilled_at is not null)
    and (fulfilled_at is null) = (fulfilled_by is null)
  ),
  constraint requisitions_cancelled_check check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (cancelled_at is null) = (cancelled_by is null)
  )
);

create table if not exists public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  requested_quantity numeric(15,3) not null check (requested_quantity > 0),
  fulfilled_quantity numeric(15,3) check (fulfilled_quantity is null or fulfilled_quantity >= 0),
  unit text not null check (nullif(btrim(unit), '') is not null),
  note text,
  created_at timestamptz not null default now(),
  unique (requisition_id, line_number),
  unique (requisition_id, inventory_item_id)
);

create table if not exists public.requisition_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  requisition_item_id uuid not null references public.requisition_items(id) on delete restrict,
  inventory_lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  quantity numeric(15,3) not null check (quantity > 0),
  is_fifo_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  -- Skipping an older usable lot is allowed, but never silently: the reason is
  -- a storage rule, not just UI copy.
  constraint requisition_lot_allocations_override_check check (
    is_fifo_override = (nullif(btrim(coalesce(override_reason, '')), '') is not null)
  )
);

create unique index if not exists requisitions_document_number_key
  on public.requisitions (lower(btrim(document_number)));
create index if not exists requisitions_status_idx
  on public.requisitions (status, desired_date);
create index if not exists requisitions_requester_idx
  on public.requisitions (requester_id) where requester_id is not null;
create index if not exists requisitions_fulfilled_by_idx
  on public.requisitions (fulfilled_by) where fulfilled_by is not null;
create index if not exists requisitions_cancelled_by_idx
  on public.requisitions (cancelled_by) where cancelled_by is not null;
create index if not exists requisitions_created_by_idx
  on public.requisitions (created_by) where created_by is not null;
create index if not exists requisitions_updated_by_idx
  on public.requisitions (updated_by) where updated_by is not null;
create index if not exists requisition_items_requisition_idx
  on public.requisition_items (requisition_id, line_number);
create index if not exists requisition_items_inventory_item_idx
  on public.requisition_items (inventory_item_id);
create index if not exists requisition_lot_allocations_item_idx
  on public.requisition_lot_allocations (requisition_item_id);
create index if not exists requisition_lot_allocations_lot_idx
  on public.requisition_lot_allocations (inventory_lot_id);
create index if not exists requisition_lot_allocations_created_by_idx
  on public.requisition_lot_allocations (created_by) where created_by is not null;
create unique index if not exists requisition_lot_allocations_item_lot_key
  on public.requisition_lot_allocations (requisition_item_id, inventory_lot_id);

drop trigger if exists requisitions_set_updated_at on public.requisitions;
create trigger requisitions_set_updated_at
before update on public.requisitions
for each row execute function public.lab_stock_set_updated_at();

drop trigger if exists requisition_lot_allocations_append_only on public.requisition_lot_allocations;
create trigger requisition_lot_allocations_append_only
before update or delete on public.requisition_lot_allocations
for each row execute function public.prevent_append_only_mutation();

create or replace function public.create_requisition(
  p_actor_id uuid,
  p_requisition jsonb,
  p_items jsonb
)
returns public.requisitions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_requisition public.requisitions%rowtype;
  parsed_desired_date date;
  parsed_fiscal_year integer;
  next_sequence integer;
  line jsonb;
  line_index integer := 0;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  if p_requisition is null or jsonb_typeof(p_requisition) <> 'object' then
    raise exception using errcode = '22023', message = 'requisition payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_requisition) field_name
    where field_name not in ('department', 'requesterName', 'desiredDate', 'note')
  ) then
    raise exception using errcode = '22023', message = 'unexpected requisition field';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'requisition must have at least one line';
  end if;

  parsed_desired_date := (p_requisition ->> 'desiredDate')::date;
  parsed_fiscal_year := extract(year from parsed_desired_date)::integer + 543
    + case when extract(month from parsed_desired_date) >= 10 then 1 else 0 end;

  perform pg_advisory_xact_lock(hashtext('labcbh_requisition_sequence'), parsed_fiscal_year);

  select coalesce(max(requisition.sequence_number), 0) + 1
  into next_sequence
  from public.requisitions requisition
  where requisition.fiscal_year = parsed_fiscal_year;

  insert into public.requisitions (
    fiscal_year,
    sequence_number,
    document_number,
    requester_id,
    requester_name,
    department,
    desired_date,
    status,
    note,
    created_by,
    updated_by
  )
  values (
    parsed_fiscal_year,
    next_sequence,
    'RQ-' || parsed_fiscal_year || '-' || lpad(next_sequence::text, 4, '0'),
    p_actor_id,
    btrim(p_requisition ->> 'requesterName'),
    btrim(p_requisition ->> 'department'),
    parsed_desired_date,
    'waiting',
    nullif(btrim(coalesce(p_requisition ->> 'note', '')), ''),
    p_actor_id,
    p_actor_id
  )
  returning * into created_requisition;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_index := line_index + 1;

    insert into public.requisition_items (
      requisition_id,
      line_number,
      inventory_item_id,
      requested_quantity,
      unit,
      note
    )
    values (
      created_requisition.id,
      line_index,
      (line ->> 'inventoryItemId')::uuid,
      (line ->> 'requestedQuantity')::numeric,
      btrim(line ->> 'unit'),
      nullif(btrim(coalesce(line ->> 'note', '')), '')
    );
  end loop;

  return created_requisition;
end
$function$;

revoke execute on function public.create_requisition(uuid, jsonb, jsonb) from public;
revoke execute on function public.create_requisition(uuid, jsonb, jsonb) from anon;
revoke execute on function public.create_requisition(uuid, jsonb, jsonb) from authenticated;
grant execute on function public.create_requisition(uuid, jsonb, jsonb) to service_role;

create or replace function public.fulfill_requisition(
  p_requisition_id uuid,
  p_actor_id uuid,
  p_allocations jsonb
)
returns public.requisitions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_requisition public.requisitions%rowtype;
  fulfilled_requisition public.requisitions%rowtype;
  line public.requisition_items%rowtype;
  allocation jsonb;
  locked_lot public.inventory_lots%rowtype;
  allocated_total numeric(15,3);
  allocation_quantity numeric(15,3);
  override_reason text;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  -- Lock first, then re-read status under the lock. Checking before locking
  -- would let two officers both see 'waiting' and both issue stock.
  select *
  into locked_requisition
  from public.requisitions requisition
  where requisition.id = p_requisition_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'requisition not found';
  end if;

  if locked_requisition.status <> 'waiting' then
    raise exception using
      errcode = '55000',
      message = format('requisition is %s and cannot be fulfilled', locked_requisition.status);
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception using errcode = '22023', message = 'allocations must be an array';
  end if;

  for line in
    select *
    from public.requisition_items item
    where item.requisition_id = p_requisition_id
    order by item.line_number
  loop
    allocated_total := 0;

    for allocation in
      select value
      from jsonb_array_elements(p_allocations) value
      where (value ->> 'requisitionItemId')::uuid = line.id
    loop
      allocation_quantity := (allocation ->> 'quantity')::numeric;
      override_reason := nullif(btrim(coalesce(allocation ->> 'overrideReason', '')), '');

      if allocation_quantity is null or allocation_quantity <= 0 then
        raise exception using errcode = '23514', message = 'allocation quantity must be positive';
      end if;

      -- Locking the lot serialises concurrent requisitions against the same
      -- remaining units; the ledger guard then re-derives the balance.
      select *
      into locked_lot
      from public.inventory_lots lot
      where lot.id = (allocation ->> 'inventoryLotId')::uuid
      for update;

      if not found then
        raise exception using errcode = '23503', message = 'inventory lot not found';
      end if;

      if locked_lot.inventory_item_id <> line.inventory_item_id then
        raise exception using
          errcode = '23514',
          message = 'lot belongs to a different inventory item';
      end if;

      if locked_lot.expiry_date is not null and locked_lot.expiry_date <= current_date then
        raise exception using
          errcode = '23514',
          message = format('expired lot cannot be issued (%s)', locked_lot.lot_number);
      end if;

      insert into public.requisition_lot_allocations (
        requisition_item_id,
        inventory_lot_id,
        quantity,
        is_fifo_override,
        override_reason,
        created_by
      )
      values (
        line.id,
        locked_lot.id,
        allocation_quantity,
        override_reason is not null,
        override_reason,
        p_actor_id
      );

      insert into public.stock_movements (
        inventory_item_id,
        inventory_lot_id,
        movement_type,
        quantity,
        occurred_on,
        source_document_type,
        source_document_id,
        note,
        created_by
      )
      values (
        line.inventory_item_id,
        locked_lot.id,
        'requisition_issue',
        -allocation_quantity,
        current_date,
        'requisition',
        p_requisition_id,
        override_reason,
        p_actor_id
      );

      allocated_total := allocated_total + allocation_quantity;
    end loop;

    if allocated_total <> line.requested_quantity then
      raise exception using
        errcode = '23514',
        message = format(
          'fulfilled quantity %s does not match requested quantity %s',
          allocated_total,
          line.requested_quantity
        );
    end if;

    update public.requisition_items
    set fulfilled_quantity = allocated_total
    where id = line.id;
  end loop;

  update public.requisitions
  set status = 'fulfilled',
      fulfilled_by = p_actor_id,
      fulfilled_at = now(),
      updated_by = p_actor_id
  where id = p_requisition_id
  returning * into fulfilled_requisition;

  return fulfilled_requisition;
end
$function$;

revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from public;
revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from anon;
revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from authenticated;
grant execute on function public.fulfill_requisition(uuid, uuid, jsonb) to service_role;

alter table public.requisitions enable row level security;
alter table public.requisition_items enable row level security;
alter table public.requisition_lot_allocations enable row level security;

revoke all on table public.requisitions from anon, authenticated;
revoke all on table public.requisition_items from anon, authenticated;
revoke all on table public.requisition_lot_allocations from anon, authenticated;

grant select on table public.requisitions to authenticated;
grant select on table public.requisition_items to authenticated;
grant select on table public.requisition_lot_allocations to authenticated;

grant select, insert, update, delete on table public.requisitions to service_role;
grant select, insert, update, delete on table public.requisition_items to service_role;
grant select, insert, update, delete on table public.requisition_lot_allocations to service_role;

drop policy if exists requisitions_app_read on public.requisitions;
create policy requisitions_app_read
on public.requisitions for select
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

drop policy if exists requisition_items_app_read on public.requisition_items;
create policy requisition_items_app_read
on public.requisition_items for select
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

drop policy if exists requisition_lot_allocations_app_read on public.requisition_lot_allocations;
create policy requisition_lot_allocations_app_read
on public.requisition_lot_allocations for select
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

commit;
