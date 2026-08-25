begin;

-- Heads may prepare a receipt draft, but posting it into the stock ledger and
-- cancelling it remain stock-operator actions. Keep this database gate
-- separate from assert_stock_officer_actor so the narrower permission does not
-- leak into purchase-request, inventory, or posting workflows.
create or replace function public.assert_goods_receipt_creator_actor(p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.ephis_id = '9495'
        or profile.role = 'Manager'
        or exists (
          select 1
          from public.lab_stock_memberships membership
          where membership.profile_id = profile.id
            and membership.active
            and membership.role in ('admin', 'stock_officer', 'head')
        )
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'actor is not allowed to create a goods receipt';
  end if;
end
$function$;

revoke execute on function public.assert_goods_receipt_creator_actor(uuid) from public;
revoke execute on function public.assert_goods_receipt_creator_actor(uuid) from anon;
revoke execute on function public.assert_goods_receipt_creator_actor(uuid) from authenticated;
grant execute on function public.assert_goods_receipt_creator_actor(uuid) to service_role;

-- Keep the latest PO-lifecycle receipt implementation while changing only its
-- actor gate. The RPC remains service-role-only; the server action supplies the
-- authenticated actor id and this helper is the authoritative role check.
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
  perform public.assert_goods_receipt_creator_actor(p_actor_id);

  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object' then
    raise exception using errcode = '22023', message = 'goods receipt payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_receipt) field_name
    where field_name not in (
      'purchaseRequestId', 'department', 'receivedDate', 'receiverName', 'note'
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
    select *
    into locked_request
    from public.purchase_requests request
    where request.id = parsed_purchase_request_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'purchase request not found';
    end if;

    if locked_request.status not in ('completed', 'partially_received') then
      raise exception using
        errcode = '55000',
        message = 'only a confirmed or partially received purchase request can be received';
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
        and receipt.status = 'draft'
    ) then
      raise exception using errcode = '55000', message = 'purchase request already has an open draft goods receipt';
    end if;

    update public.purchase_request_items pr_item
    set received_quantity = coalesce((
      select sum(receipt_item.quantity)
      from public.goods_receipts receipt
      join public.goods_receipt_items receipt_item
        on receipt_item.goods_receipt_id = receipt.id
      where receipt.purchase_request_id = parsed_purchase_request_id
        and receipt.status = 'posted'
        and receipt_item.inventory_item_id = pr_item.inventory_item_id
    ), 0)
    where pr_item.purchase_request_id = parsed_purchase_request_id;

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
         or totals.total_quantity > pr_item.remaining_quantity
    ) then
      raise exception using
        errcode = '23514',
        message = 'received items and quantities exceed the purchase request remaining quantity';
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
    case
      when parsed_purchase_request_id is not null then nullif(btrim(locked_request.po_number), '')
      else null
    end,
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

revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_goods_receipt(uuid, jsonb, jsonb)
  to service_role;

commit;
