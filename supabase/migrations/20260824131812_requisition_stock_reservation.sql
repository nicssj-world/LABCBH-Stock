-- Reserve stock at requisition creation without writing a fake issue to the
-- immutable ledger. A waiting requisition is the reservation: its requested
-- lines are subtracted from usable lot balances until the row is fulfilled or
-- cancelled.

begin;

create or replace view public.inventory_item_requisition_availability
with (security_invoker = true) as
with usable_lots as (
  select
    lot.inventory_item_id,
    coalesce(sum(lot_balance.balance), 0)::numeric(15,3) as usable_on_hand
  from public.inventory_lots lot
  left join public.inventory_lot_balances lot_balance
    on lot_balance.inventory_lot_id = lot.id
  where coalesce(lot_balance.balance, 0) > 0
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

-- The caller must lock item rows before reading the derived balance. Every
-- mutation that can create, release, or consume a reservation uses this same
-- lock order, so two concurrent requests cannot both spend the same available
-- quantity. The optional item-id union lets update_requisition also lock lines
-- that are about to be removed.
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

  -- PostgreSQL applies the row locks in this explicit order. The helper can
  -- also receive old line ids during an edit; ids without a new quantity are
  -- locked but deliberately skipped by the availability check below.
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
  item_ids uuid[] := '{}'::uuid[];
  requested_quantities jsonb := '{}'::jsonb;
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

  if nullif(btrim(coalesce(p_requisition ->> 'department', '')), '') is null then
    raise exception using errcode = '22023', message = 'department is required';
  end if;

  if nullif(btrim(coalesce(p_requisition ->> 'requesterName', '')), '') is null then
    raise exception using errcode = '22023', message = 'requester name is required';
  end if;

  if p_requisition ->> 'desiredDate' is null then
    raise exception using errcode = '22023', message = 'desired date is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'requisition must have at least one line';
  end if;

  for line in select value from jsonb_array_elements(p_items) value
  loop
    if nullif(btrim(coalesce(line ->> 'inventoryItemId', '')), '') is null then
      raise exception using errcode = '22023', message = 'inventory item id is required';
    end if;

    if (line ->> 'requestedQuantity') is null then
      raise exception using errcode = '22023', message = 'requested quantity is required';
    end if;

    item_ids := array_append(item_ids, (line ->> 'inventoryItemId')::uuid);
    requested_quantities := requested_quantities || jsonb_build_object(
      line ->> 'inventoryItemId',
      (line ->> 'requestedQuantity')::numeric
    );
  end loop;

  parsed_desired_date := (p_requisition ->> 'desiredDate')::date;
  parsed_fiscal_year := extract(year from parsed_desired_date)::integer + 543
    + case when extract(month from parsed_desired_date) >= 10 then 1 else 0 end;

  -- This is the reservation point. No requisition row or stock movement is
  -- written until the locked, reservation-aware availability check succeeds.
  perform public.assert_requisition_stock_available(item_ids, requested_quantities, null);

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

  for line in select value from jsonb_array_elements(p_items) value
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

create or replace function public.update_requisition(
  p_requisition_id uuid,
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
  locked_requisition public.requisitions%rowtype;
  updated_requisition public.requisitions%rowtype;
  parsed_desired_date date;
  parsed_fiscal_year integer;
  line jsonb;
  line_index integer := 0;
  item_ids uuid[] := '{}'::uuid[];
  requested_quantities jsonb := '{}'::jsonb;
begin
  select *
  into locked_requisition
  from public.requisitions requisition
  where requisition.id = p_requisition_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'requisition not found';
  end if;

  if locked_requisition.status <> 'waiting' then
    raise exception using
      errcode = '55000',
      message = format('requisition is %s and cannot be edited', locked_requisition.status);
  end if;

  perform public.assert_requisition_manager(p_actor_id, locked_requisition.requester_id);

  if p_requisition is null or jsonb_typeof(p_requisition) <> 'object' then
    raise exception using errcode = '22023', message = 'requisition payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_requisition) field_name
    where field_name not in ('department', 'requesterName', 'desiredDate', 'note')
  ) then
    raise exception using errcode = '22023', message = 'unexpected requisition field';
  end if;

  if nullif(btrim(coalesce(p_requisition ->> 'department', '')), '') is null then
    raise exception using errcode = '22023', message = 'department is required';
  end if;

  if nullif(btrim(coalesce(p_requisition ->> 'requesterName', '')), '') is null then
    raise exception using errcode = '22023', message = 'requester name is required';
  end if;

  if p_requisition ->> 'desiredDate' is null then
    raise exception using errcode = '22023', message = 'desired date is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'requisition must have at least one line';
  end if;

  parsed_desired_date := (p_requisition ->> 'desiredDate')::date;
  parsed_fiscal_year := extract(year from parsed_desired_date)::integer + 543
    + case when extract(month from parsed_desired_date) >= 10 then 1 else 0 end;

  if parsed_fiscal_year <> locked_requisition.fiscal_year then
    raise exception using
      errcode = '22023',
      message = 'แก้วันที่ข้ามปีงบประมาณไม่ได้ กรุณายกเลิกแล้วสร้างใบเบิกใหม่';
  end if;

  if exists (
    select 1
    from public.requisition_lot_allocations allocation
    join public.requisition_items item on item.id = allocation.requisition_item_id
    where item.requisition_id = locked_requisition.id
  ) then
    raise exception using
      errcode = '55000',
      message = 'requisition already has lot allocations';
  end if;

  for line in select value from jsonb_array_elements(p_items) value
  loop
    if nullif(btrim(coalesce(line ->> 'inventoryItemId', '')), '') is null then
      raise exception using errcode = '22023', message = 'inventory item id is required';
    end if;

    if (line ->> 'requestedQuantity') is null then
      raise exception using errcode = '22023', message = 'requested quantity is required';
    end if;

    item_ids := array_append(item_ids, (line ->> 'inventoryItemId')::uuid);
    requested_quantities := requested_quantities || jsonb_build_object(
      line ->> 'inventoryItemId',
      (line ->> 'requestedQuantity')::numeric
    );
  end loop;

  -- Lock the union of old and new lines in one deterministic pass. Excluding
  -- this requisition means its old reservation is released for the check
  -- before the replacement lines are written.
  perform 1
  from public.inventory_items catalogue
  where catalogue.id in (
    select item.inventory_item_id
    from public.requisition_items item
    where item.requisition_id = locked_requisition.id
    union
    select new_item_id
    from unnest(item_ids) requested_item(new_item_id)
  )
  order by catalogue.id
  for update;

  perform public.assert_requisition_stock_available(item_ids, requested_quantities, locked_requisition.id);

  update public.requisitions
  set department = btrim(p_requisition ->> 'department'),
      requester_name = btrim(p_requisition ->> 'requesterName'),
      desired_date = parsed_desired_date,
      note = nullif(btrim(coalesce(p_requisition ->> 'note', '')), ''),
      updated_by = p_actor_id
  where id = locked_requisition.id
  returning * into updated_requisition;

  delete from public.requisition_items
  where requisition_id = locked_requisition.id;

  for line in select value from jsonb_array_elements(p_items) value
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
      updated_requisition.id,
      line_index,
      (line ->> 'inventoryItemId')::uuid,
      (line ->> 'requestedQuantity')::numeric,
      btrim(line ->> 'unit'),
      nullif(btrim(coalesce(line ->> 'note', '')), '')
    );
  end loop;

  return updated_requisition;
end
$function$;

revoke execute on function public.update_requisition(uuid, uuid, jsonb, jsonb) from public;
revoke execute on function public.update_requisition(uuid, uuid, jsonb, jsonb) from anon;
revoke execute on function public.update_requisition(uuid, uuid, jsonb, jsonb) from authenticated;
grant execute on function public.update_requisition(uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.cancel_requisition(
  p_requisition_id uuid,
  p_actor_id uuid
)
returns public.requisitions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_requisition public.requisitions%rowtype;
  cancelled_requisition public.requisitions%rowtype;
begin
  select *
  into locked_requisition
  from public.requisitions requisition
  where requisition.id = p_requisition_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'requisition not found';
  end if;

  if locked_requisition.status <> 'waiting' then
    raise exception using
      errcode = '55000',
      message = format('requisition is %s and cannot be cancelled', locked_requisition.status);
  end if;

  perform public.assert_requisition_manager(p_actor_id, locked_requisition.requester_id);

  -- Serialize the release with a concurrent create/update on every item this
  -- requisition currently reserves. Changing status then releases the implied
  -- reservation without touching the append-only stock ledger.
  perform 1
  from public.inventory_items catalogue
  where catalogue.id in (
    select item.inventory_item_id
    from public.requisition_items item
    where item.requisition_id = locked_requisition.id
  )
  order by catalogue.id
  for update;

  update public.requisitions
  set status = 'cancelled',
      cancelled_by = p_actor_id,
      cancelled_at = now(),
      updated_by = p_actor_id
  where id = locked_requisition.id
  returning * into cancelled_requisition;

  return cancelled_requisition;
end
$function$;

revoke execute on function public.cancel_requisition(uuid, uuid) from public;
revoke execute on function public.cancel_requisition(uuid, uuid) from anon;
revoke execute on function public.cancel_requisition(uuid, uuid) from authenticated;
grant execute on function public.cancel_requisition(uuid, uuid) to service_role;

-- Final fulfilment definition: retain FIFO and immutable issue behaviour, but
-- acquire the same parent-item locks before trusting lots. That closes the
-- race between a new reservation and the physical issue transaction.
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

  perform 1
  from public.inventory_items catalogue
  where catalogue.id in (
    select item.inventory_item_id
    from public.requisition_items item
    where item.requisition_id = locked_requisition.id
  )
  order by catalogue.id
  for update;

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

revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from public;
revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from anon;
revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from authenticated;
grant execute on function public.fulfill_requisition(uuid, uuid, jsonb) to service_role;

commit;
