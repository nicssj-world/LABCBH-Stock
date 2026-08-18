begin;

-- The legacy delta RPC remains available for internal compatibility, but it
-- must now point at a real lot whose expiry date is known. New UI work uses the
-- counted-target RPC below, which can create a new lot atomically.
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
  locked_item_id uuid;
  lot_item_id uuid;
  lot_expiry_date date;
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

  if p_inventory_lot_id is null then
    raise exception using
      errcode = '23514',
      message = 'stock adjustment requires a lot';
  end if;

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

  select lot.inventory_item_id, lot.expiry_date
  into lot_item_id, lot_expiry_date
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

  if lot_expiry_date is null then
    raise exception using
      errcode = '23514',
      message = 'stock adjustment requires a lot expiry date';
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
    coalesce(p_occurred_on, public.lab_stock_today()),
    'manual_adjustment',
    btrim(p_reason),
    p_actor_id
  )
  returning * into inserted;

  return inserted;
end
$function$;

-- Set a counted balance from a lot number and expiry date. The item row and
-- target lot are locked before the current balance is read; a new lot is
-- created before its first movement, so the complete operation is atomic.
create or replace function public.set_stock_balance(
  p_inventory_item_id uuid,
  p_actor_id uuid,
  p_target_quantity numeric,
  p_reason text,
  p_inventory_lot_id uuid default null,
  p_lot_number text default null,
  p_expiry_date date default null,
  p_occurred_on date default null
)
returns public.stock_movements
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_item_id uuid;
  target_lot public.inventory_lots%rowtype;
  current_balance numeric(15,3);
  delta numeric(15,3);
  inserted public.stock_movements;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using
      errcode = '23514',
      message = 'stock balance adjustment requires a reason';
  end if;

  if nullif(btrim(coalesce(p_lot_number, '')), '') is null then
    raise exception using
      errcode = '23514',
      message = 'stock balance adjustment requires a lot number';
  end if;

  if p_expiry_date is null then
    raise exception using
      errcode = '23514',
      message = 'stock balance adjustment requires a lot expiry date';
  end if;

  if p_target_quantity is null or p_target_quantity < 0 then
    raise exception using
      errcode = '23514',
      message = 'stock target quantity must be zero or greater';
  end if;

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
    select *
    into target_lot
    from public.inventory_lots lot
    where lot.id = p_inventory_lot_id
    for update;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'inventory lot does not exist';
    end if;

    if target_lot.inventory_item_id <> p_inventory_item_id then
      raise exception using
        errcode = '23514',
        message = 'lot belongs to a different inventory item';
    end if;

    if upper(btrim(target_lot.lot_number)) <> upper(btrim(p_lot_number)) then
      raise exception using
        errcode = '23514',
        message = 'lot number does not match the selected lot';
    end if;
  else
    select *
    into target_lot
    from public.inventory_lots lot
    where lot.inventory_item_id = p_inventory_item_id
      and upper(btrim(lot.lot_number)) = upper(btrim(p_lot_number))
    order by lot.id
    for update;

    if not found then
      if p_target_quantity <= 0 then
        raise exception using
          errcode = '23514',
          message = 'a new lot must have a counted quantity greater than zero';
      end if;

      insert into public.inventory_lots (
        inventory_item_id,
        lot_number,
        expiry_date,
        received_date,
        original_quantity,
        note,
        created_by,
        updated_by
      )
      values (
        p_inventory_item_id,
        btrim(p_lot_number),
        p_expiry_date,
        coalesce(p_occurred_on, public.lab_stock_today()),
        p_target_quantity,
        'สร้างล็อตจากการปรับยอดคงคลัง',
        p_actor_id,
        p_actor_id
      )
      returning * into target_lot;
    end if;
  end if;

  if target_lot.expiry_date is null then
    update public.inventory_lots
    set expiry_date = p_expiry_date,
        updated_by = p_actor_id
    where id = target_lot.id
    returning * into target_lot;
  elsif target_lot.expiry_date <> p_expiry_date then
    raise exception using
      errcode = '23514',
      message = 'lot expiry date does not match the existing lot';
  end if;

  select coalesce(sum(movement.quantity), 0)
  into current_balance
  from public.stock_movements movement
  where movement.inventory_lot_id = target_lot.id;

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
    target_lot.id,
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

-- Disable the previous lot-less target overload. The new eight-argument
-- overload is the only target-setting entry point for the application.
revoke execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, date) from service_role;
revoke execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, date) from public, anon, authenticated;
revoke execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, text, date, date) from public;
revoke execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, text, date, date) from anon;
revoke execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, text, date, date) from authenticated;
grant execute on function public.set_stock_balance(uuid, uuid, numeric, text, uuid, text, date, date) to service_role;

revoke execute on function public.record_stock_adjustment(uuid, uuid, numeric, text, uuid, date) from public, anon, authenticated;
grant execute on function public.record_stock_adjustment(uuid, uuid, numeric, text, uuid, date) to service_role;

commit;
