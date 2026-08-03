-- A goods receipt referencing a purchase request could receive more of a
-- reagent than that PR ever requested — nothing compared p_items against
-- purchase_request_items.requested_quantity, and splitting the same item
-- across two lots (two goods_receipt_items rows) made it easy to miss even
-- with a manual eyeball check. Group incoming items by inventory_item_id so
-- a split-across-lots receipt cannot slip past the ceiling either.
begin;

create or replace function public.create_goods_receipt(
  p_actor_id uuid,
  p_receipt jsonb,
  p_items jsonb
)
returns public.goods_receipts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_receipt public.goods_receipts%rowtype;
  parsed_received_date date;
  parsed_purchase_request_id uuid;
  line jsonb;
  line_index integer := 0;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object' then
    raise exception using errcode = '22023', message = 'goods receipt payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_receipt) field_name
    where field_name not in (
      'purchaseRequestId', 'poNumber', 'department', 'receivedDate', 'receiverName', 'note'
    )
  ) then
    raise exception using errcode = '22023', message = 'unexpected goods receipt field';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'goods receipt must have at least one line';
  end if;

  parsed_received_date := (p_receipt ->> 'receivedDate')::date;
  parsed_purchase_request_id := nullif(p_receipt ->> 'purchaseRequestId', '')::uuid;

  -- A reagent can arrive split across several lots (several p_items rows share
  -- one inventoryItemId); sum before comparing so splitting cannot hide an
  -- overage that a single-line check would have caught.
  if parsed_purchase_request_id is not null then
    if exists (
      select 1
      from (
        select
          (item ->> 'inventoryItemId')::uuid as inventory_item_id,
          sum((item ->> 'quantity')::numeric) as total_quantity
        from jsonb_array_elements(p_items) item
        group by (item ->> 'inventoryItemId')::uuid
      ) totals
      join public.purchase_request_items pr_item
        on pr_item.purchase_request_id = parsed_purchase_request_id
        and pr_item.inventory_item_id = totals.inventory_item_id
      where totals.total_quantity > pr_item.requested_quantity
    ) then
      raise exception using
        errcode = '23514',
        message = 'received quantity exceeds the purchase request''s requested quantity';
    end if;
  end if;

  insert into public.goods_receipts (
    fiscal_year,
    purchase_request_id,
    po_number,
    department,
    received_date,
    receiver_name,
    received_by,
    status,
    note,
    created_by,
    updated_by
  )
  values (
    extract(year from parsed_received_date)::integer + 543
      + case when extract(month from parsed_received_date) >= 10 then 1 else 0 end,
    parsed_purchase_request_id,
    nullif(btrim(coalesce(p_receipt ->> 'poNumber', '')), ''),
    btrim(p_receipt ->> 'department'),
    parsed_received_date,
    btrim(p_receipt ->> 'receiverName'),
    p_actor_id,
    'draft',
    nullif(btrim(coalesce(p_receipt ->> 'note', '')), ''),
    p_actor_id,
    p_actor_id
  )
  returning * into created_receipt;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_index := line_index + 1;

    insert into public.goods_receipt_items (
      goods_receipt_id,
      line_number,
      inventory_item_id,
      lot_number,
      expiry_date,
      quantity,
      unit,
      storage_location
    )
    values (
      created_receipt.id,
      line_index,
      (line ->> 'inventoryItemId')::uuid,
      btrim(line ->> 'lotNumber'),
      nullif(line ->> 'expiryDate', '')::date,
      (line ->> 'quantity')::numeric,
      btrim(line ->> 'unit'),
      nullif(btrim(coalesce(line ->> 'storageLocation', '')), '')
    );
  end loop;

  return created_receipt;
end
$function$;

revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb) from public;
revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb) from anon;
revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb) from authenticated;
grant execute on function public.create_goods_receipt(uuid, jsonb, jsonb) to service_role;

commit;
