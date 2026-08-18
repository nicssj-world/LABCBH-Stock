begin;

-- Set a counted balance without trusting the browser's snapshot. The item row
-- and, when present, the selected lot are locked before the current balance is
-- read, so the delta is calculated inside the same transaction as the ledger
-- insert.
create or replace function public.set_stock_balance(
  p_inventory_item_id uuid,
  p_actor_id uuid,
  p_target_quantity numeric,
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
  locked_item_id uuid;
  lot_item_id uuid;
  current_balance numeric(15,3);
  delta numeric(15,3);
  inserted public.stock_movements;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using
      errcode = '23514',
      message = 'stock balance adjustment requires a reason';
  end if;

  if p_target_quantity is null or p_target_quantity < 0 then
    raise exception using
      errcode = '23514',
      message = 'stock target quantity must be zero or greater';
  end if;

  -- The ledger stores numeric(15,3); make the target use the same precision
  -- before comparing it with a derived balance.
  p_target_quantity := round(p_target_quantity, 3);

  select item.id
  into locked_item_id
  from public.inventory_items item
  where item.id = p_inventory_item_id
  for update;

  if locked_item_id is null then
    raise exception using
      errcode = '23503',
      message = 'inventory item does not exist';
  end if;

  if p_inventory_lot_id is not null then
    select lot.inventory_item_id
    into lot_item_id
    from public.inventory_lots lot
    where lot.id = p_inventory_lot_id
    for update;

    if lot_item_id is null then
      raise exception using
        errcode = '23503',
        message = 'inventory lot does not exist';
    end if;

    if lot_item_id <> p_inventory_item_id then
      raise exception using
        errcode = '23514',
        message = 'lot belongs to a different inventory item';
    end if;

    select coalesce(sum(movement.quantity), 0)
    into current_balance
    from public.stock_movements movement
    where movement.inventory_lot_id = p_inventory_lot_id;
  else
    -- A lot-less balance is only valid for a catalog item that has no lots.
    -- Once lots exist, every physical count must identify its lot.
    if exists (
      select 1
      from public.inventory_lots lot
      where lot.inventory_item_id = p_inventory_item_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'stock balance adjustment must select a lot';
    end if;

    select coalesce(sum(movement.quantity), 0)
    into current_balance
    from public.stock_movements movement
    where movement.inventory_item_id = p_inventory_item_id;
  end if;

  delta := round(p_target_quantity - current_balance, 3);

  if delta = 0 then
    raise exception using
      errcode = '23514',
      message = 'stock balance already matches target';
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
    delta,
    coalesce(p_occurred_on, public.lab_stock_today()),
    'manual_adjustment',
    btrim(p_reason),
    p_actor_id
  )
  returning * into inserted;

  return inserted;
end
$function$;

revoke execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, date) from public;
revoke execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, date) from anon;
revoke execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, date) from authenticated;
grant execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, date) to service_role;

commit;
