-- Narrow what "รายการต้องทำ PR" counts, from every non-healthy row to the rows
-- somebody can actually act on.
--
-- Measured against production on 2026-08-21: the chip counted 117 of 172 active
-- items, and 115 of those 117 had never had a single stock movement. That is
-- because the catalogue was imported from the old Google Sheet ahead of the
-- system going into real use: receiving has barely started, so most rows have
-- no ledger history yet. inventory_item_balances left-joins stock_movements, so
-- each of them reports on_hand = 0, which classifyStockLevel reads as
-- 'depleted'. On staging it was 198 of 198. A number that is 98-100% noise is
-- one nobody reads, including on the day it matters.
--
-- So an item enters the worklist when it enters real operation, rather than the
-- whole catalogue shouting from day one. During ramp-up that means the alert
-- stays quiet by design; minimum_stock_override is the way to put an item on
-- the list before its first receipt.
--
-- Two read-only views supply the facts the count was missing. Both are
-- security_invoker and select-only, like inventory_item_balances beside them;
-- no write path changes.
begin;

-- (1) Has this item ever moved at all? An item with no movement history is a
--     catalogue entry, not a stock-out. Kept as a view rather than a column so
--     it cannot drift from the ledger it summarises.
create or replace view public.inventory_item_movement_presence
with (security_invoker = true) as
select
  item.id as inventory_item_id,
  exists (
    select 1
    from public.stock_movements movement
    where movement.inventory_item_id = item.id
  ) as has_movements
from public.inventory_items item;

comment on view public.inventory_item_movement_presence is
  'Whether an inventory item has any ledger history, used to keep never-stocked catalogue rows out of the restock alert.';

-- (2) Is a purchase request already open for it? The old count never looked at
--     purchase_requests, so raising a PR left the number unchanged — it could
--     only fall when goods were received. A worklist you cannot clear by doing
--     the work it names is not a worklist.
--
--     'draft' and 'pending' are the two live states in PURCHASE_REQUEST_STATUSES;
--     completed/cancelled/reversed all mean the request is no longer coming.
create or replace view public.inventory_item_open_requests
with (security_invoker = true) as
select distinct line.inventory_item_id
from public.purchase_request_items line
join public.purchase_requests request on request.id = line.purchase_request_id
where request.status in ('draft', 'pending');

comment on view public.inventory_item_open_requests is
  'Inventory items already covered by a draft or pending purchase request.';

revoke all on public.inventory_item_movement_presence from anon, authenticated;
revoke all on public.inventory_item_open_requests from anon, authenticated;
grant select on public.inventory_item_movement_presence to authenticated;
grant select on public.inventory_item_open_requests to authenticated;
grant select on public.inventory_item_movement_presence to service_role;
grant select on public.inventory_item_open_requests to service_role;

commit;
