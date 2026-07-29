import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const listPage = read('app/(protected)/inventory/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(listPage, /listInventoryItems\(/, 'the catalog must be read on the server')
assert.match(listPage, /ค้นหา/, 'LS/name search must be offered')
assert.match(listPage, /หน่วยงานที่รับผิดชอบ/, 'department filter must be offered')
assert.match(listPage, /InventoryTable/)
assert.doesNotMatch(listPage, /^['"]use client['"]/m, 'the catalog page stays a Server Component')

const detailPage = read('app/(protected)/inventory/[id]/page.tsx')
assert.match(detailPage, /params:\s*Promise</, 'Next 16 params must be awaited')
assert.match(detailPage, /getInventoryItem\(/)
assert.match(detailPage, /LotTable/)
assert.match(detailPage, /MinimumStockEditor/)
assert.match(detailPage, /ชื่อเรียกอื่นที่พบในข้อมูลเดิม/, 'aliases must stay visible for reconciliation')
assert.match(detailPage, /canOperateStock/, 'only admin/stock officers may edit the minimum')

const table = read('components/inventory/InventoryTable.tsx')
assert.match(table, /ต้องทำ PR/, 'items at or below minimum must show the Thai call to action')
assert.match(table, /inventory-table--desktop/, 'desktop table variant must exist')
assert.match(table, /inventory-task-cards/, 'mobile task-card variant must exist')
assert.match(table, /คงเหลือ/)
assert.match(table, /ขั้นต่ำ/)

const lotTable = read('components/inventory/LotTable.tsx')
assert.match(lotTable, /เลขที่ล็อต/)
assert.match(lotTable, /LOT_EXPIRY_LABELS/, 'expiry wording comes from the shared presenter')
assert.match(lotTable, /LOT_EXPIRY_TONES/, 'severity must carry a text label, not colour alone')

// The presenter is the single source of the Thai expiry vocabulary.
const presenter = read('lib/inventory/presenter.ts')
assert.match(presenter, /หมดอายุแล้ว/)
assert.match(presenter, /ใกล้หมดอายุ/)
assert.match(presenter, /ต่ำกว่าขั้นต่ำ/)
assert.match(presenter, /หมดคลัง/)

const editor = read('components/inventory/MinimumStockEditor.tsx')
assert.match(editor, /^['"]use client['"]/m, 'only the interactive editor is a client boundary')
assert.match(editor, /setMinimumStock/, 'the editor must call a typed Server Action')
assert.match(editor, /ค่าที่ระบบแนะนำ/, 'the suggested minimum must stay visible next to the override')
assert.doesNotMatch(
  editor,
  /createBrowserClient|supabase\.from/,
  'the browser must never mutate Supabase directly',
)

const actions = read('lib/inventory/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /supabaseAdmin\.rpc\('set_inventory_minimum_stock'/)
assert.match(actions, /supabaseAdmin\.rpc\('record_stock_adjustment'/)
assert.match(actions, /assertStockOperator/, 'adjustments require an authorized stock operator')

const queries = read('lib/inventory/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /createClient/, 'catalog reads stay under RLS')
assert.doesNotMatch(queries, /supabaseAdmin/, 'reads must not escalate to the service role')
assert.match(queries, /stock_movements/, 'balances come from the movement ledger')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/inventory/, 'the shell must link to the inventory catalog')

console.log('inventory UI: ok')
