# Partial receiving rollout runbook

This change lets one PR have several Posted goods receipts. The authoritative
receiving total is the sum of Posted receipt lines grouped by inventory item;
the cached `purchase_request_items.received_quantity` is reconciled under the
PR row lock before a draft is created or Posted.

## Migration order

Run the migrations through the repository migration runner in filename order.
Do not paste a migration into the SQL editor as the normal deployment path:
the SQL may be applied while the Supabase migration history remains behind.

1. `20260821160000_partial_receiving_compatibility.sql`
2. `20260821163000_partial_receiving_acknowledgement.sql`
3. `20260821164000_partial_receiving_trigger_scope.sql`
4. Deploy the application version that understands `partially_received`,
   `received`, and the per-line received/remaining quantities.
5. `20260821170000_partial_receiving_backfill.sql`
6. Deploy the application version that understands `closed_short`.
7. `20260821180000_partial_receiving_short_close.sql`

The acknowledgement and trigger-scope migrations are corrective compatibility
steps for databases that still have the original acknowledgement check or a
legacy contract-integrity trigger. They are intentionally separate from the
data backfill so a failed reconciliation does not leave a half-updated status
set.

## Preflight and verification

Before backfill, reconcile any historical overage. The backfill must stop when
this query returns rows:

```sql
select
  receipt.purchase_request_id,
  receipt_item.inventory_item_id,
  sum(receipt_item.quantity) as posted_quantity,
  max(pr_item.requested_quantity) as requested_quantity
from public.goods_receipts receipt
join public.goods_receipt_items receipt_item
  on receipt_item.goods_receipt_id = receipt.id
join public.purchase_request_items pr_item
  on pr_item.purchase_request_id = receipt.purchase_request_id
 and pr_item.inventory_item_id = receipt_item.inventory_item_id
where receipt.status = 'posted'
  and receipt.purchase_request_id is not null
group by receipt.purchase_request_id, receipt_item.inventory_item_id
having sum(receipt_item.quantity) > max(pr_item.requested_quantity);
```

After every environment rollout, verify:

```sql
select status, count(*)
from public.purchase_requests
group by status
order by status;

select count(*) as cache_mismatches
from public.purchase_request_items pr_item
where pr_item.received_quantity <> coalesce((
  select sum(receipt_item.quantity)
  from public.goods_receipts receipt
  join public.goods_receipt_items receipt_item
    on receipt_item.goods_receipt_id = receipt.id
  where receipt.purchase_request_id = pr_item.purchase_request_id
    and receipt.status = 'posted'
    and receipt_item.inventory_item_id = pr_item.inventory_item_id
), 0);

select count(*) as open_draft_duplicates
from (
  select purchase_request_id
  from public.goods_receipts
  where purchase_request_id is not null and status = 'draft'
  group by purchase_request_id
  having count(*) > 1
) duplicates;
```

`cache_mismatches` and `open_draft_duplicates` must both be zero. A PR in
`closed_short` must have `closed_short_by`, `closed_short_at`, and a nonblank
`closed_short_reason`; it must not appear in the receiving PR picker.

## Staging to production checklist

- [ ] Capture the migration list and the three verification query results for
      Staging.
- [ ] Exercise 100 → 60 → 25 → 15 with separate Posted receipts, including a
      split across two LOTs for one item.
- [ ] Confirm a second Draft is rejected, and a cancelled Draft releases the
      PR for a new receipt.
- [ ] Confirm an overage is rejected by both the browser and the RPC.
- [ ] Confirm a Posted receipt is immutable and a stock correction creates an
      audited `manual_adjustment` movement from the inventory item page.
- [ ] Confirm short close requires a reason, records actor/time, preserves
      the remaining quantity, and blocks further receiving.
- [ ] Record the migration versions in the environment's migration history.
- [ ] Repeat the same checks in Production after the release window opens.

If SQL was already run manually in an environment, do not insert rows directly
into a migration-history table. Have the database operator reconcile the
record using the approved Supabase migration-repair procedure, after proving
that the SQL body ran successfully. Keep the evidence with the deployment.
