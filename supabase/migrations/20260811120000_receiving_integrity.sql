begin;

-- A purchase request can have at most one active receipt. Cancelled legacy
-- receipts are excluded so a future cancellation workflow can receive the PR
-- again without weakening the protection against two open/posted receipts.
do $duplicates$
begin
  if exists (
    select purchase_request_id
    from public.goods_receipts
    where purchase_request_id is not null
      and status <> 'cancelled'
    group by purchase_request_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate active goods receipts per purchase request must be reconciled before applying the receiving integrity migration';
  end if;
end
$duplicates$;

create unique index if not exists goods_receipts_active_purchase_request_key
  on public.goods_receipts (purchase_request_id)
  where purchase_request_id is not null
    and status <> 'cancelled';

-- Recreate the RPC with a PR-row lock. The unique index is the final safety
-- net, while the lock makes concurrent callers receive a useful domain error.
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
  locked_request public.purchase_requests%rowtype;
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

  if parsed_purchase_request_id is not null then
    -- The lock is shared with every other receipt creation for this PR. A
    -- second officer therefore observes the first draft before inserting.
    select *
    into locked_request
    from public.purchase_requests request
    where request.id = parsed_purchase_request_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'purchase request not found';
    end if;

    if locked_request.status is distinct from 'completed' then
      raise exception using errcode = '55000', message = 'only a completed purchase request can be received';
    end if;

    if coalesce(locked_request.purchase_method, '') not in (
      'annual_plan', 'contract', 'awaiting_contract', 'off_plan'
    ) then
      raise exception using errcode = '55000', message = 'this purchase request is not receivable against a purchase order';
    end if;

    if locked_request.department is distinct from btrim(p_receipt ->> 'department') then
      raise exception using errcode = '42501', message = 'purchase request belongs to a different department';
    end if;

    if exists (
      select 1
      from public.goods_receipts receipt
      where receipt.purchase_request_id = parsed_purchase_request_id
        and receipt.status <> 'cancelled'
    ) then
      raise exception using errcode = '55000', message = 'purchase request already has an active goods receipt';
    end if;

    -- A linked receipt may only contain items requested by that PR, and the
    -- aggregate quantity across lots cannot exceed the requested quantity.
    if exists (
      select 1
      from (
        select
          (item ->> 'inventoryItemId')::uuid as inventory_item_id,
          sum((item ->> 'quantity')::numeric) as total_quantity
        from jsonb_array_elements(p_items) item
        group by (item ->> 'inventoryItemId')::uuid
      ) totals
      left join public.purchase_request_items pr_item
        on pr_item.purchase_request_id = parsed_purchase_request_id
       and pr_item.inventory_item_id = totals.inventory_item_id
      where pr_item.id is null
         or totals.total_quantity > pr_item.requested_quantity
    ) then
      raise exception using
        errcode = '23514',
        message = 'received items and quantities must match the purchase request';
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

revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_goods_receipt(uuid, jsonb, jsonb) to service_role;

commit;
