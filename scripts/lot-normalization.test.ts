import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { detectDuplicateLots } from '../lib/receipts/schema'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((name) => name.endsWith('_lab_stock_lot_normalization.sql'))
assert.equal(names.length, 1, 'exactly one lot-normalization migration must exist')
const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')
const preflight = readFileSync(join(process.cwd(), 'scripts', 'lot-normalization-preflight.mjs'), 'utf8')

assert.match(sql, /group by inventory_item_id, upper\(btrim\(lot_number\)\)/i)
assert.match(sql, /reconcile inventory_lots and stock_movements/i)
assert.match(sql, /generated always as \(upper\(btrim\(lot_number\)\)\) stored/i)
assert.match(sql, /inventory_lots_item_lot_key/i)
assert.match(sql, /on conflict \(inventory_item_id, lot_number_key\)/i)
assert.match(sql, /revoke execute on function public\.post_goods_receipt/i)
assert.match(sql, /grant execute on function public\.post_goods_receipt[\s\S]*?to service_role/i)
assert.match(preflight, /REFUSING|reconcile duplicate lots/i)
assert.match(preflight, /from\('inventory_lots'\)/)
assert.doesNotMatch(preflight, /\.insert\(|\.update\(|\.delete\(/, 'lot preflight must stay read-only')

assert.deepEqual(
  detectDuplicateLots([
    { inventoryItemId: 'item', lotNumber: 'L1' },
    { inventoryItemId: 'item', lotNumber: 'l1 ' },
  ]),
  ['item::L1'],
)

console.log('lot normalization: ok')
