begin;

-- Rollout order: apply this compatibility migration before deploying the app
-- that understands the new PR statuses. Apply the separate backfill migration
-- only after that app version is serving reads.

-- Persist the posted quantity for fast reads. remaining_quantity is generated
-- from the PR ceiling, while every receiving RPC reconciles received_quantity
-- from posted receipt lines under the PR row lock before trusting it.
alter table public.purchase_request_items
  add column if not exists received_quantity numeric(15,3) not null default 0;

alter table public.purchase_request_items
  add column if not exists remaining_quantity numeric(15,3)
  generated always as (requested_quantity - received_quantity) stored;

alter table public.purchase_request_items
  drop constraint if exists purchase_request_items_received_quantity_check;

alter table public.purchase_request_items
  add constraint purchase_request_items_received_quantity_check
  check (received_quantity >= 0 and received_quantity <= requested_quantity);

alter table public.purchase_requests
  drop constraint if exists purchase_requests_status_check;

alter table public.purchase_requests
  add constraint purchase_requests_status_check check (status in (
    'draft',
    'pending',
    'completed',
    'partially_received',
    'received',
    'cancelled',
    'reversed'
  ));

alter table public.goods_receipts
  add column if not exists cancelled_by uuid references public.profiles(id) on delete restrict,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_note text;

create index if not exists goods_receipts_cancelled_by_idx
  on public.goods_receipts (cancelled_by) where cancelled_by is not null;

-- A PR may be received many times, but only one officer may have an unfinished
-- draft open for it. Posted and cancelled receipts remain as audit history.
drop index if exists public.goods_receipts_active_purchase_request_key;

do $duplicate_drafts$
begin
  if exists (
    select purchase_request_id
    from public.goods_receipts
    where purchase_request_id is not null
      and status = 'draft'
    group by purchase_request_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate draft goods receipts per purchase request must be reconciled before enabling partial receiving';
  end if;
end
$duplicate_drafts$;

create unique index if not exists goods_receipts_one_draft_purchase_request_key
  on public.goods_receipts (purchase_request_id)
  where purchase_request_id is not null
    and status = 'draft';

-- The same PO can legitimately deliver more than once on the same day.
drop index if exists public.goods_receipts_po_number_key;

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

    -- Reconcile the cached quantity from immutable posted receipt history before
    -- using it as the ceiling for this draft.
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

    -- One reagent can be split across several LOT lines. Compare the sum for
    -- this draft against the remaining PR quantity for that reagent.
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

create or replace function public.post_goods_receipt(
  p_receipt_id uuid,
  p_actor_id uuid
)
returns public.goods_receipts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_receipt public.goods_receipts%rowtype;
  locked_request public.purchase_requests%rowtype;
  posted_receipt public.goods_receipts%rowtype;
  line public.goods_receipt_items%rowtype;
  target_lot_id uuid;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  select *
  into locked_receipt
  from public.goods_receipts receipt
  where receipt.id = p_receipt_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'goods receipt not found';
  end if;

  if locked_receipt.status <> 'draft' then
    raise exception using
      errcode = '55000',
      message = format('goods receipt is %s and cannot be posted', locked_receipt.status);
  end if;

  if locked_receipt.purchase_request_id is not null then
    select *
    into locked_request
    from public.purchase_requests request
    where request.id = locked_receipt.purchase_request_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'purchase request not found';
    end if;

    if locked_request.status not in ('completed', 'partially_received') then
      raise exception using errcode = '55000', message = 'purchase request is no longer open for receiving';
    end if;

    update public.purchase_request_items pr_item
    set received_quantity = coalesce((
      select sum(receipt_item.quantity)
      from public.goods_receipts receipt
      join public.goods_receipt_items receipt_item
        on receipt_item.goods_receipt_id = receipt.id
      where receipt.purchase_request_id = locked_receipt.purchase_request_id
        and receipt.status = 'posted'
        and receipt_item.inventory_item_id = pr_item.inventory_item_id
    ), 0)
    where pr_item.purchase_request_id = locked_receipt.purchase_request_id;

    if exists (
      select 1
      from (
        select inventory_item_id, sum(quantity) as total_quantity
        from public.goods_receipt_items
        where goods_receipt_id = p_receipt_id
        group by inventory_item_id
      ) totals
      left join public.purchase_request_items pr_item
        on pr_item.purchase_request_id = locked_receipt.purchase_request_id
       and pr_item.inventory_item_id = totals.inventory_item_id
      where pr_item.id is null
         or totals.total_quantity > pr_item.remaining_quantity
    ) then
      raise exception using
        errcode = '23514',
        message = 'received items and quantities exceed the purchase request remaining quantity';
    end if;
  end if;

  for line in
    select *
    from public.goods_receipt_items item
    where item.goods_receipt_id = p_receipt_id
    order by item.line_number
  loop
    insert into public.inventory_lots (
      inventory_item_id,
      goods_receipt_item_id,
      lot_number,
      expiry_date,
      received_date,
      original_quantity,
      storage_location,
      created_by,
      updated_by
    )
    values (
      line.inventory_item_id,
      line.id,
      line.lot_number,
      line.expiry_date,
      locked_receipt.received_date,
      line.quantity,
      line.storage_location,
      p_actor_id,
      p_actor_id
    )
    on conflict (inventory_item_id, lot_number_key) do update
      set expiry_date = coalesce(public.inventory_lots.expiry_date, excluded.expiry_date),
          storage_location = coalesce(excluded.storage_location, public.inventory_lots.storage_location),
          updated_by = p_actor_id
    returning id into target_lot_id;

    update public.goods_receipt_items
    set inventory_lot_id = target_lot_id
    where id = line.id;

    insert into public.stock_movements (
      inventory_item_id,
      inventory_lot_id,
      movement_type,
      quantity,
      occurred_on,
      source_document_type,
      source_document_id,
      created_by
    )
    values (
      line.inventory_item_id,
      target_lot_id,
      'goods_receipt',
      line.quantity,
      locked_receipt.received_date,
      'goods_receipt',
      p_receipt_id,
      p_actor_id
    )
    on conflict do nothing;
  end loop;

  update public.goods_receipts
  set status = 'posted',
      posted_by = p_actor_id,
      posted_at = now(),
      updated_by = p_actor_id
  where id = p_receipt_id
  returning * into posted_receipt;

  if locked_receipt.purchase_request_id is not null then
    update public.purchase_request_items pr_item
    set received_quantity = coalesce((
      select sum(receipt_item.quantity)
      from public.goods_receipts receipt
      join public.goods_receipt_items receipt_item
        on receipt_item.goods_receipt_id = receipt.id
      where receipt.purchase_request_id = locked_receipt.purchase_request_id
        and receipt.status = 'posted'
        and receipt_item.inventory_item_id = pr_item.inventory_item_id
    ), 0)
    where pr_item.purchase_request_id = locked_receipt.purchase_request_id;

    update public.purchase_requests request
    set status = case
          when exists (
            select 1
            from public.purchase_request_items item
            where item.purchase_request_id = locked_receipt.purchase_request_id
              and item.remaining_quantity > 0
          ) then 'partially_received'
          else 'received'
        end,
        updated_by = p_actor_id
    where request.id = locked_receipt.purchase_request_id;
  end if;

  return posted_receipt;
end
$function$;

revoke execute on function public.post_goods_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.post_goods_receipt(uuid, uuid) to service_role;

create or replace function public.cancel_goods_receipt(
  p_receipt_id uuid,
  p_actor_id uuid,
  p_note text default null
)
returns public.goods_receipts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_receipt public.goods_receipts%rowtype;
  cancelled_receipt public.goods_receipts%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  select *
  into locked_receipt
  from public.goods_receipts receipt
  where receipt.id = p_receipt_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'goods receipt not found';
  end if;

  if locked_receipt.status <> 'draft' then
    raise exception using
      errcode = '55000',
      message = format('goods receipt is %s and cannot be cancelled', locked_receipt.status);
  end if;

  update public.goods_receipts
  set status = 'cancelled',
      cancelled_by = p_actor_id,
      cancelled_at = now(),
      cancellation_note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_by = p_actor_id
  where id = p_receipt_id
  returning * into cancelled_receipt;

  return cancelled_receipt;
end
$function$;

revoke execute on function public.cancel_goods_receipt(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_goods_receipt(uuid, uuid, text) to service_role;

-- Reversal of a PR with physical receiving history would leave the contract
-- allocation and stock ledger describing different realities. An unfinished
-- draft must be cancelled first so it cannot be posted after reversal.
create or replace function public.guard_purchase_request_receipt_reversal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'reversed' and old.status is distinct from 'reversed' then
    if exists (
      select 1
      from public.goods_receipts receipt
      where receipt.purchase_request_id = old.id
        and receipt.status = 'posted'
    ) then
      raise exception using errcode = '55000', message = 'a purchase request with posted goods receipts cannot be reversed';
    end if;

    if exists (
      select 1
      from public.goods_receipts receipt
      where receipt.purchase_request_id = old.id
        and receipt.status = 'draft'
    ) then
      raise exception using errcode = '55000', message = 'cancel the open draft goods receipt before reversing the purchase request';
    end if;
  end if;

  return new;
end
$function$;

revoke execute on function public.guard_purchase_request_receipt_reversal() from public, anon, authenticated;

drop trigger if exists purchase_requests_guard_receipt_reversal on public.purchase_requests;
create trigger purchase_requests_guard_receipt_reversal
before update of status on public.purchase_requests
for each row execute function public.guard_purchase_request_receipt_reversal();

commit;
