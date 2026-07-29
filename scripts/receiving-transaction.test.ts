import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { detectDuplicateLots, summarizeReceiptLines } from '../lib/receipts/schema'

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
const receivingSql = read('_lab_stock_receiving.sql')

// 1. Idempotency comes from the ledger's unique index on the source document
//    plus item plus lot, so a retry collides instead of double-counting.
assert.match(
  ledgerSql,
  /create unique index if not exists stock_movements_source_document_key[\s\S]*?source_document_type,\s*source_document_id,\s*inventory_item_id,\s*coalesce\(inventory_lot_id/i,
)

const post = receivingSql.match(
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
assert.match(post, /on conflict \(inventory_item_id, lot_number\)/i)
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

console.log('receiving transaction contract: ok (static; live post/retry pass pending a database)')
