import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { detectDuplicateLots, findOverRequestedItems, summarizeReceiptLines } from '../lib/receipts/schema'

/**
 * Contract test for posting a receipt.
 *
 * The scenario this protects: one receipt with two lots posts exactly two
 * positive movements, and pressing "post" again adds none.
 *
 * NOTE: exercising that against a live Postgres needs `npx supabase db reset`,
 * which the plan schedules for the staging pass in Task 12. Until a database is
 * reachable this asserts the properties the guarantee rests on.
 */

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const read = (suffix: string) => {
  const name = readdirSync(migrationsDir).find((file) => file.endsWith(suffix))
  assert.ok(name, `missing migration ${suffix}`)
  return readFileSync(join(migrationsDir, name), 'utf8')
}

const ledgerSql = read('_lab_stock_inventory_ledger.sql')
const partialReceivingSql = read('_partial_receiving_compatibility.sql')
const partialReceivingBackfillSql = read('_partial_receiving_backfill.sql')
const poLifecycleSql = read('_purchase_request_po_file_lifecycle.sql')

// 1. Idempotency comes from the ledger's unique index on the source document
//    plus item plus lot, so a retry collides instead of double-counting.
assert.match(
  ledgerSql,
  /create unique index if not exists stock_movements_source_document_key[\s\S]*?source_document_type,\s*source_document_id,\s*inventory_item_id,\s*coalesce\(inventory_lot_id/i,
)

const post = partialReceivingSql.match(
  /create or replace function public\.post_goods_receipt[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(post, 'post_goods_receipt must exist')
assert.match(post, /language plpgsql/i)

// 2. One movement per receipt line, each tagged with the receipt as its source.
assert.match(post, /for\s+\w+\s+in[\s\S]*?from public\.goods_receipt_items/i)
assert.match(post, /source_document_id/i)
assert.match(post, /p_receipt_id/i)
assert.match(post, /movement_type/i)

// 3. A retry is absorbed rather than raising, so a double click cannot leave the
//    receipt half-posted.
assert.match(post, /on conflict[\s\S]{0,200}do nothing/i)

// 4. The receipt row is locked and its status re-read under the lock, so two
//    officers posting at once cannot both proceed.
assert.match(post, /from public\.goods_receipts[\s\S]*?for update/i)
assert.match(post, /status <> 'draft'/i)
assert.ok(
  post.indexOf('for update') < post.indexOf("status <> 'draft'"),
  'status must be re-read under the lock, not before it',
)

// 5. Receiving the same lot again adds a movement instead of rewriting the lot,
//    so history stays truthful.
assert.match(post, /on conflict \(inventory_item_id, lot_number_key\)/i)
assert.doesNotMatch(post, /delete from public\.(stock_movements|inventory_lots)/i)

// 6. Negative stock stays impossible: the Task 5 guard runs before every insert.
assert.match(
  ledgerSql,
  /create trigger stock_movements_guard_balance\s+before insert on public\.stock_movements/i,
)

// 7. Duplicate lots inside one draft are surfaced to the officer before posting.
const lines = [
  { inventoryItemId: 'a', lotNumber: 'L1', quantity: 5 },
  { inventoryItemId: 'a', lotNumber: 'l1 ', quantity: 3 },
  { inventoryItemId: 'b', lotNumber: 'L1', quantity: 2 },
]
assert.deepEqual(detectDuplicateLots(lines), ['a::L1'], 'lot numbers match case- and space-insensitively')
assert.deepEqual(detectDuplicateLots([lines[0], lines[2]]), [])

assert.deepEqual(summarizeReceiptLines(lines), { lineCount: 3, totalQuantity: 10 })

// 8. Receiving more of a reagent than the referenced PR requested is caught,
//    even when split across two lots (two lines share one inventoryItemId).
assert.deepEqual(
  findOverRequestedItems(
    [{ inventoryItemId: 'a', quantity: 30 }, { inventoryItemId: 'a', quantity: 30 }],
    { a: 50 },
  ),
  ['a'],
  'splitting the same item across two lots must not hide an overage',
)
assert.deepEqual(
  findOverRequestedItems([{ inventoryItemId: 'a', quantity: 50 }], { a: 50 }),
  [],
  'receiving exactly the requested quantity is not an overage',
)
assert.deepEqual(
  findOverRequestedItems([{ inventoryItemId: 'a', quantity: 999 }], {}),
  [],
  'an item the PR never listed has no ceiling to exceed',
)
assert.deepEqual(
  findOverRequestedItems([{ inventoryItemId: 'a', quantity: 1 }], {}, true),
  ['a'],
  'a receipt linked to a PR must reject an item the PR never listed',
)
assert.deepEqual(
  findOverRequestedItems(
    [{ inventoryItemId: 'a', quantity: 10 }, { inventoryItemId: 'b', quantity: 999 }],
    { a: 50 },
  ),
  [],
  'only the flagged item must be reported, not every line',
)

// 9. create_goods_receipt itself must reject the same overage server-side —
//    the client check alone would be decoration without this.
const createGoodsReceipt = partialReceivingSql.match(
  /create or replace function public\.create_goods_receipt[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(createGoodsReceipt, 'create_goods_receipt must be redefined with the quantity ceiling')
assert.match(createGoodsReceipt, /security invoker/i)
assert.match(createGoodsReceipt, /set search_path = ''/i)
assert.match(
  createGoodsReceipt,
  /group by \(item ->> 'inventoryItemId'\)::uuid/i,
  'quantities must be grouped by item so a split-across-lots receipt cannot dodge the ceiling',
)
assert.match(
  createGoodsReceipt,
  /join public\.purchase_request_items pr_item[\s\S]*?total_quantity > pr_item\.remaining_quantity/i,
)
assert.match(createGoodsReceipt, /receipt\.status = 'posted'/i, 'draft creation must reconcile posted history only')
assert.match(createGoodsReceipt, /set received_quantity = coalesce/i)
assert.match(createGoodsReceipt, /remaining quantity/i)
assert.match(createGoodsReceipt, /if parsed_purchase_request_id is not null then/i)
assert.match(createGoodsReceipt, /locked_request\.status not in \('completed', 'partially_received'\)/i)
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    partialReceivingSql,
    new RegExp(`revoke execute on function public\\.create_goods_receipt[\\s\\S]*?from[\\s\\S]*?${role}`, 'i'),
  )
}
assert.match(
  partialReceivingSql,
  /grant execute on function public\.create_goods_receipt[\s\S]*?to service_role/i,
)

assert.match(partialReceivingSql, /for update/i, 'receipt creation must lock the referenced PR before checking drafts')
assert.match(partialReceivingSql, /purchase request already has an open draft goods receipt/i)
assert.match(partialReceivingSql, /left join public\.purchase_request_items pr_item/i)
assert.match(partialReceivingSql, /pr_item\.id is null/i)
assert.match(partialReceivingSql, /purchase request belongs to a different department/i)

const lifecycleCreateGoodsReceipt = poLifecycleSql.match(
  /create or replace function public\.create_goods_receipt[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(lifecycleCreateGoodsReceipt, 'the PO lifecycle migration must replace create_goods_receipt')
assert.match(
  lifecycleCreateGoodsReceipt,
  /field_name not in \([\s\S]*?'purchaseRequestId',[\s\S]*?'department',[\s\S]*?'receivedDate',[\s\S]*?'receiverName',[\s\S]*?'note'/i,
  'receipt creation must reject client-owned PO number fields',
)
assert.doesNotMatch(lifecycleCreateGoodsReceipt, /'poNumber'/i)
assert.match(lifecycleCreateGoodsReceipt, /locked_request\.po_number/i)
assert.match(
  lifecycleCreateGoodsReceipt,
  /case[\s\S]*?when parsed_purchase_request_id is not null[\s\S]*?else null/i,
  'unlinked receipts must not receive a client-supplied PO snapshot',
)

assert.match(post, /from public\.purchase_requests[\s\S]*?for update/i, 'posting must also lock the PR')
assert.ok((post.match(/set received_quantity = coalesce/gi) ?? []).length >= 2, 'posting reconciles received quantity before and after posting')
assert.match(post, /total_quantity > pr_item\.remaining_quantity/i, 'posting re-checks the draft against the latest remainder')
assert.match(post, /then 'partially_received'[\s\S]*?else 'received'/i)

// Cancelled drafts release the draft lock without altering posted quantities.
// Posted receipts are deliberately not cancellable.
const cancelGoodsReceipt = partialReceivingSql.match(
  /create or replace function public\.cancel_goods_receipt[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(cancelGoodsReceipt, 'cancel_goods_receipt must exist')
assert.match(cancelGoodsReceipt, /status <> 'draft'/i)
assert.match(cancelGoodsReceipt, /set status = 'cancelled'/i)
assert.doesNotMatch(cancelGoodsReceipt, /received_quantity|stock_movements/i)

// Existing rows are migrated from posted history in a later rollout step.
assert.match(partialReceivingBackfillSql, /where receipt\.status = 'posted'/i)
assert.match(partialReceivingBackfillSql, /totals\.received_quantity > pr_item\.requested_quantity/i)
assert.match(partialReceivingBackfillSql, /then 'completed'[\s\S]*?then 'partially_received'[\s\S]*?else 'received'/i)

console.log('receiving transaction contract: ok (static; live post/retry pass pending a database)')
