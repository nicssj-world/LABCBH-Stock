begin;

-- Validate FIFO against the complete allocation payload and any allocations
-- already written for the item. This supports both the atomic RPC and direct
-- service-role inserts through the same database boundary.
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

revoke execute on function public.assert_requisition_fifo(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.assert_requisition_fifo(uuid, jsonb) to service_role;

create or replace function public.validate_requisition_fifo_allocation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform public.assert_requisition_fifo(
    new.requisition_item_id,
    jsonb_build_array(
      jsonb_build_object(
        'requisitionItemId', new.requisition_item_id,
        'inventoryLotId', new.inventory_lot_id,
        'overrideReason', new.override_reason
      )
    )
  );
  return new;
end
$function$;

revoke execute on function public.validate_requisition_fifo_allocation() from public, anon, authenticated;
drop trigger if exists requisition_lot_allocations_fifo_guard on public.requisition_lot_allocations;
create trigger requisition_lot_allocations_fifo_guard
before insert on public.requisition_lot_allocations
for each row execute function public.validate_requisition_fifo_allocation();

-- Reapply fulfillment with the database FIFO check and Bangkok business date;
-- the original function remains forward-compatible for already-applied DBs.
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
    perform public.assert_requisition_fifo(line.id, p_allocations);
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

      if locked_lot.expiry_date is not null and locked_lot.expiry_date <= public.lab_stock_today() then
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
        public.lab_stock_today(),
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

revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fulfill_requisition(uuid, uuid, jsonb) to service_role;

commit;
