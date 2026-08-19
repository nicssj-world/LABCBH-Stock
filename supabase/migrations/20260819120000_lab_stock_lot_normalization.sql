begin;

-- The application rule is that a handwritten `L1`, `l1`, or `l1 ` label is
-- one physical lot. Do not silently merge existing rows: a deployment with
-- historical collisions must stop and be reconciled with its ledger intact.
do $check_existing_lot_collisions$
begin
  if exists (
    select 1
    from public.inventory_lots
    group by inventory_item_id, upper(btrim(lot_number))
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'inventory lot normalization found existing duplicate lot labels; reconcile inventory_lots and stock_movements before applying this migration';
  end if;
end
$check_existing_lot_collisions$;

-- Keep the label that was written on the receiving document for audit display,
-- while enforcing one normalized key for future receiving and adjustments.
alter table public.inventory_lots
  add column if not exists lot_number_key text
  generated always as (upper(btrim(lot_number))) stored;

create unique index if not exists inventory_lots_item_lot_key
  on public.inventory_lots (inventory_item_id, lot_number_key);

-- Re-define the posting RPC so a later receipt with a different case or a
-- trailing space resolves to the existing physical lot. The receipt line keeps
-- its original label; only the internal lot identity is shared.
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
  posted_receipt public.goods_receipts%rowtype;
  line public.goods_receipt_items%rowtype;
  target_lot_id uuid;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  -- Lock first, then re-read status under the lock. Checking before locking
  -- would let two officers both see 'draft' and both post.
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

    -- The source-document key absorbs a retry, so posting twice cannot create
    -- a second movement even when the lot was resolved by its normalized key.
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

  return posted_receipt;
end
$function$;

revoke execute on function public.post_goods_receipt(uuid, uuid) from public;
revoke execute on function public.post_goods_receipt(uuid, uuid) from anon;
revoke execute on function public.post_goods_receipt(uuid, uuid) from authenticated;
grant execute on function public.post_goods_receipt(uuid, uuid) to service_role;

commit;
