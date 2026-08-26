-- Keep a lot in the immutable stock history while allowing stock operators to
-- remove it from future FIFO issues. Inactive lots can still be reconciled and
-- audited; they simply are not usable stock for requisitions.
begin;

alter table public.inventory_lots
  add column if not exists is_active boolean not null default true;

create index if not exists inventory_lots_active_fifo_idx
  on public.inventory_lots (inventory_item_id, is_active, received_date, expiry_date);

create or replace function public.set_inventory_lot_active(
  p_inventory_lot_id uuid,
  p_actor_id uuid,
  p_is_active boolean
)
returns public.inventory_lots
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.inventory_lots;
begin
  if p_is_active is null then
    raise exception using errcode = '22004', message = 'is_active is required';
  end if;

  update public.inventory_lots
  set
    is_active = p_is_active,
    updated_at = now(),
    updated_by = p_actor_id
  where id = p_inventory_lot_id
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'inventory lot not found';
  end if;

  return updated;
end
$function$;

revoke execute on function public.set_inventory_lot_active(uuid, uuid, boolean) from public;
revoke execute on function public.set_inventory_lot_active(uuid, uuid, boolean) from anon;
revoke execute on function public.set_inventory_lot_active(uuid, uuid, boolean) from authenticated;
grant execute on function public.set_inventory_lot_active(uuid, uuid, boolean) to service_role;

-- Only active, non-expired lots contribute to the amount that can be
-- requested. Physical on-hand remains the sum of the complete ledger.
create or replace view public.inventory_item_requisition_availability
with (security_invoker = true) as
with usable_lots as (
  select
    lot.inventory_item_id,
    coalesce(sum(lot_balance.balance), 0)::numeric(15,3) as usable_on_hand
  from public.inventory_lots lot
  left join public.inventory_lot_balances lot_balance
    on lot_balance.inventory_lot_id = lot.id
  where lot.is_active
    and coalesce(lot_balance.balance, 0) > 0
    and (lot.expiry_date is null or lot.expiry_date > public.lab_stock_today())
  group by lot.inventory_item_id
),
waiting_requisitions as (
  select
    item.inventory_item_id,
    coalesce(sum(item.requested_quantity), 0)::numeric(15,3) as waiting_reserved
  from public.requisition_items item
  join public.requisitions requisition on requisition.id = item.requisition_id
  where requisition.status = 'waiting'
  group by item.inventory_item_id
)
select
  catalogue.id as inventory_item_id,
  coalesce(usable_lots.usable_on_hand, 0)::numeric(15,3) as usable_on_hand,
  coalesce(waiting_requisitions.waiting_reserved, 0)::numeric(15,3) as waiting_reserved,
  greatest(
    coalesce(usable_lots.usable_on_hand, 0) - coalesce(waiting_requisitions.waiting_reserved, 0),
    0
  )::numeric(15,3) as available_to_request
from public.inventory_items catalogue
left join usable_lots on usable_lots.inventory_item_id = catalogue.id
left join waiting_requisitions on waiting_requisitions.inventory_item_id = catalogue.id;

revoke all on public.inventory_item_requisition_availability from anon, authenticated;
grant select on public.inventory_item_requisition_availability to authenticated;
grant select on public.inventory_item_requisition_availability to service_role;

-- Keep reservation checks aligned with the availability view. Item rows are
-- still locked first so concurrent requests cannot spend the same active stock.
create or replace function public.assert_requisition_stock_available(
  p_item_ids uuid[],
  p_requested_quantities jsonb,
  p_exclude_requisition_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_item_id uuid;
  requested_quantity numeric(15,3);
  usable_on_hand numeric(15,3);
  waiting_reserved numeric(15,3);
  available_to_request numeric(15,3);
  item_code text;
  item_name text;
  distinct_item_count integer;
  existing_item_count integer;
begin
  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    raise exception using errcode = '22023', message = 'requisition must have at least one inventory item';
  end if;

  if p_requested_quantities is null or jsonb_typeof(p_requested_quantities) <> 'object' then
    raise exception using errcode = '22023', message = 'requested quantities must be an object';
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) ids(item_id)
    where ids.item_id is null
  ) then
    raise exception using errcode = '22023', message = 'inventory item id is required';
  end if;

  select count(*)
  into distinct_item_count
  from (select distinct ids.item_id from unnest(p_item_ids) ids(item_id)) unique_items;

  if distinct_item_count <> cardinality(p_item_ids) then
    raise exception using errcode = '23505', message = 'a requisition cannot contain the same inventory item twice';
  end if;

  select count(*)
  into existing_item_count
  from public.inventory_items catalogue
  where catalogue.id = any(p_item_ids)
    and catalogue.is_active;

  if existing_item_count <> distinct_item_count then
    raise exception using errcode = '23503', message = 'inventory item not found or inactive';
  end if;

  perform 1
  from public.inventory_items catalogue
  where catalogue.id = any(p_item_ids)
  order by catalogue.id
  for update;

  for current_item_id in
    select distinct ids.item_id
    from unnest(p_item_ids) ids(item_id)
    order by ids.item_id
  loop
    if not (p_requested_quantities ? current_item_id::text) then
      continue;
    end if;

    requested_quantity := (p_requested_quantities ->> current_item_id::text)::numeric;
    if requested_quantity is null or requested_quantity <= 0 then
      raise exception using
        errcode = '23514',
        message = 'requested quantity must be positive';
    end if;

    select coalesce(sum(lot_balance.balance), 0)::numeric(15,3)
    into usable_on_hand
    from public.inventory_lots lot
    left join public.inventory_lot_balances lot_balance
      on lot_balance.inventory_lot_id = lot.id
    where lot.inventory_item_id = current_item_id
      and lot.is_active
      and coalesce(lot_balance.balance, 0) > 0
      and (lot.expiry_date is null or lot.expiry_date > public.lab_stock_today());

    select coalesce(sum(item.requested_quantity), 0)::numeric(15,3)
    into waiting_reserved
    from public.requisition_items item
    join public.requisitions requisition on requisition.id = item.requisition_id
    where item.inventory_item_id = current_item_id
      and requisition.status = 'waiting'
      and (p_exclude_requisition_id is null or requisition.id <> p_exclude_requisition_id);

    available_to_request := greatest(usable_on_hand - waiting_reserved, 0)::numeric(15,3);

    if available_to_request < requested_quantity then
      select catalogue.ls_code, catalogue.name
      into item_code, item_name
      from public.inventory_items catalogue
      where catalogue.id = current_item_id;

      raise exception using
        errcode = '23514',
        message = format(
          'รายการ %s (%s) เบิกได้อีก %s แต่ขอ %s',
          item_code,
          item_name,
          available_to_request,
          requested_quantity
        );
    end if;
  end loop;
end
$function$;

revoke execute on function public.assert_requisition_stock_available(uuid[], jsonb, uuid) from public;
revoke execute on function public.assert_requisition_stock_available(uuid[], jsonb, uuid) from anon;
revoke execute on function public.assert_requisition_stock_available(uuid[], jsonb, uuid) from authenticated;
grant execute on function public.assert_requisition_stock_available(uuid[], jsonb, uuid) to service_role;

-- FIFO is a database boundary as well as a UI hint. A lot deactivated after a
-- requisition page was opened must fail before an allocation or issue row can
-- be written.
create or replace function public.assert_requisition_fifo(
  p_requisition_item_id uuid,
  p_allocations jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  requested_inventory_item_id uuid;
  requisition_status text;
  has_override_reason boolean;
  skipped_before_selected boolean := false;
  fifo_lot record;
begin
  select item.inventory_item_id, requisition.status
  into requested_inventory_item_id, requisition_status
  from public.requisition_items item
  join public.requisitions requisition on requisition.id = item.requisition_id
  where item.id = p_requisition_item_id;

  if not found then
    raise exception using errcode = '23503', message = 'requisition item not found';
  end if;

  if requisition_status is distinct from 'waiting' then
    raise exception using errcode = '55000', message = 'only a waiting requisition can be allocated';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception using errcode = '22023', message = 'allocations must be an array';
  end if;

  if exists (
    select 1
    from public.requisition_lot_allocations existing
    join public.inventory_lots lot on lot.id = existing.inventory_lot_id
    where existing.requisition_item_id = p_requisition_item_id
      and not lot.is_active
  ) or exists (
    select 1
    from jsonb_array_elements(p_allocations) allocation
    join public.inventory_lots lot on lot.id = (allocation ->> 'inventoryLotId')::uuid
    where (allocation ->> 'requisitionItemId')::uuid = p_requisition_item_id
      and not lot.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'inactive lot cannot be issued';
  end if;

  select
    exists (
      select 1
      from public.requisition_lot_allocations existing
      where existing.requisition_item_id = p_requisition_item_id
        and nullif(btrim(existing.override_reason), '') is not null
    )
    or exists (
      select 1
      from jsonb_array_elements(p_allocations) allocation
      where (allocation ->> 'requisitionItemId')::uuid = p_requisition_item_id
        and nullif(btrim(coalesce(allocation ->> 'overrideReason', '')), '') is not null
    )
  into has_override_reason;

  for fifo_lot in
    select
      lot.id,
      lot.received_date,
      lot.expiry_date,
      coalesce(balance.balance, 0) as balance
    from public.inventory_lots lot
    left join public.inventory_lot_balances balance on balance.inventory_lot_id = lot.id
    where lot.inventory_item_id = requested_inventory_item_id
      and lot.is_active
      and coalesce(balance.balance, 0) > 0
      and (lot.expiry_date is null or lot.expiry_date > public.lab_stock_today())
    order by
      lot.received_date asc,
      lot.expiry_date asc nulls last,
      coalesce(balance.balance, 0) asc,
      lot.id asc
  loop
    if exists (
      select 1
      from public.requisition_lot_allocations existing
      where existing.requisition_item_id = p_requisition_item_id
        and existing.inventory_lot_id = fifo_lot.id
    ) or exists (
      select 1
      from jsonb_array_elements(p_allocations) allocation
      where (allocation ->> 'requisitionItemId')::uuid = p_requisition_item_id
        and (allocation ->> 'inventoryLotId')::uuid = fifo_lot.id
    ) then
      if skipped_before_selected and not has_override_reason then
        raise exception using
          errcode = '23514',
          message = 'FIFO override reason is required when a usable earlier lot is skipped';
      end if;
      skipped_before_selected := false;
    else
      skipped_before_selected := true;
    end if;
  end loop;
end
$function$;

revoke execute on function public.assert_requisition_fifo(uuid, jsonb) from public;
revoke execute on function public.assert_requisition_fifo(uuid, jsonb) from anon;
revoke execute on function public.assert_requisition_fifo(uuid, jsonb) from authenticated;
grant execute on function public.assert_requisition_fifo(uuid, jsonb) to service_role;

commit;
