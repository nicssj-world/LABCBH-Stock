begin;

-- Deploy the application version that accepts partially_received/received
-- before applying this file. Keeping the data rewrite separate prevents the
-- previous application version from reading statuses outside its enum.

-- Refuse to conceal historical corruption. The earlier receiving ceiling made
-- overages impossible through the app, but imported/manual rows still deserve
-- an explicit deployment guard before the cache is populated.
do $posted_receipt_overage$
begin
  if exists (
    select 1
    from public.purchase_request_items pr_item
    join (
      select
        receipt.purchase_request_id,
        receipt_item.inventory_item_id,
        sum(receipt_item.quantity) as received_quantity
      from public.goods_receipts receipt
      join public.goods_receipt_items receipt_item
        on receipt_item.goods_receipt_id = receipt.id
      where receipt.status = 'posted'
        and receipt.purchase_request_id is not null
      group by receipt.purchase_request_id, receipt_item.inventory_item_id
    ) totals
      on totals.purchase_request_id = pr_item.purchase_request_id
     and totals.inventory_item_id = pr_item.inventory_item_id
    where totals.received_quantity > pr_item.requested_quantity
  ) then
    raise exception using
      errcode = '23514',
      message = 'posted goods receipt history exceeds its purchase request; reconcile before partial receiving backfill';
  end if;
end
$posted_receipt_overage$;

update public.purchase_request_items pr_item
set received_quantity = coalesce((
  select sum(receipt_item.quantity)
  from public.goods_receipts receipt
  join public.goods_receipt_items receipt_item
    on receipt_item.goods_receipt_id = receipt.id
  where receipt.purchase_request_id = pr_item.purchase_request_id
    and receipt.status = 'posted'
    and receipt_item.inventory_item_id = pr_item.inventory_item_id
), 0);

update public.purchase_requests request
set status = case
      when not exists (
        select 1
        from public.purchase_request_items item
        where item.purchase_request_id = request.id
          and item.received_quantity > 0
      ) then 'completed'
      when exists (
        select 1
        from public.purchase_request_items item
        where item.purchase_request_id = request.id
          and item.remaining_quantity > 0
      ) then 'partially_received'
      else 'received'
    end
where request.status in ('completed', 'partially_received', 'received')
  and request.purchase_method in ('annual_plan', 'contract', 'awaiting_contract', 'off_plan')
  and exists (
    select 1
    from public.purchase_request_items item
    where item.purchase_request_id = request.id
  );

commit;
