import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const listPage = read('app/(protected)/inventory/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(listPage, /listInventoryItems\(/, 'the catalog must be read on the server')
assert.match(listPage, /ค้นหา/, 'LS/name search must be offered')
assert.match(listPage, /หน่วยงานที่รับผิดชอบ/, 'department filter must be offered')
assert.match(listPage, /AutoFilterBench/, 'inventory filters must update the list immediately')
assert.doesNotMatch(listPage, /แสดงผล/, 'inventory filters must not require an apply button')
assert.match(listPage, /InventoryTable/)
assert.match(listPage, /canOperateStock/, 'only stock operators may see the catalog creation action')
assert.match(listPage, /href="\/inventory\/new"/)
assert.doesNotMatch(listPage, /^['"]use client['"]/m, 'the catalog page stays a Server Component')
assert.match(listPage, /InventoryMinimumStockSettings/, 'the catalog header must offer the system-wide minimum-stock control')
assert.match(listPage, /hasAppRole\(actor, 'admin'\)/, 'only admins may see the system-wide minimum-stock control')
assert.match(listPage, /getInventoryMinimumStockMonths/, 'the current reserve-months value must come from the shared setting')

const newItemPage = read('app/(protected)/inventory/new/page.tsx')
assert.match(newItemPage, /canOperateStock/, 'the new-item route must enforce the stock-operator role')
assert.match(newItemPage, /redirect\('\/access-denied'\)/)
assert.match(newItemPage, /InventoryItemForm/)

const newItemForm = read('components/inventory/InventoryItemForm.tsx')
assert.match(newItemForm, /^['"]use client['"]/m)
assert.match(newItemForm, /createInventoryItem/)
assert.match(newItemForm, /รหัสพัสดุ/)
assert.match(newItemForm, /หน่วยนับ/)
assert.match(newItemForm, /หน่วยงานที่รับผิดชอบ[\s\S]*<select/, 'responsible department must use a real select')
assert.doesNotMatch(newItemForm, /list="inventory-department-options"/, 'datalist must not trap the selected department')
assert.match(newItemForm, /การสร้างรายการนี้ยังไม่เพิ่มยอด stock/)

const createActions = read('lib/inventory/actions.ts')
assert.match(createActions, /createInventoryItem/)
assert.match(createActions, /supabaseAdmin\.rpc\('create_inventory_item'/)
assert.match(createActions, /assertStockOperator/, 'catalog creation must require an authorized stock operator')

const detailPage = read('app/(protected)/inventory/[id]/page.tsx')
assert.match(detailPage, /params:\s*Promise</, 'Next 16 params must be awaited')
assert.match(detailPage, /getInventoryItem\(/)
assert.match(detailPage, /LotTable/)
assert.match(detailPage, /item\.note/, 'the item note must be visible on the detail page')
assert.doesNotMatch(
  detailPage,
  /MinimumStockEditor/,
  'per-item minimum editing moved to the catalog table, not the detail page',
)
assert.match(detailPage, /ชื่อเรียกอื่นที่พบในข้อมูลเดิม/, 'aliases must stay visible for reconciliation')

assert.match(detailPage, /StockAdjustmentDialog/, 'stock operators need a balance-adjustment control on every item detail')

const adjustmentDialog = read('components/inventory/StockAdjustmentDialog.tsx')
assert.match(adjustmentDialog, /^['"]use client['"]/m)
assert.match(adjustmentDialog, /setStockBalance/, 'the dialog must submit a counted target balance')
assert.match(adjustmentDialog, /targetQuantity/, 'the user enters the physical count rather than a signed delta')
assert.match(adjustmentDialog, /inventoryLotId/, 'the dialog must submit the selected lot')
assert.match(adjustmentDialog, /lotNumber/, 'every adjustment must carry a lot number')
assert.match(adjustmentDialog, /expiryDate/, 'every adjustment must carry an expiry date')
assert.match(adjustmentDialog, /NEW_LOT/, 'the dialog must support creating a lot when none exists')
assert.match(adjustmentDialog, /ThaiDateInput/, 'adjustments must carry an explicit business date')
assert.doesNotMatch(adjustmentDialog, /createBrowserClient|supabase\.from/, 'the browser must never mutate Supabase directly')

const table = read('components/inventory/InventoryTable.tsx')
assert.match(table, /ต้องทำ PR/, 'items at or below minimum must show the Thai call to action')
assert.match(table, /inventory-table--desktop/, 'desktop table variant must exist')
assert.match(table, /inventory-task-cards/, 'mobile task-card variant must exist')
assert.match(table, /คงเหลือ/)
assert.match(table, /ขั้นต่ำ/)
assert.match(table, /MinimumStockEditor/, 'the catalog row is where the per-item override now lives')
assert.match(table, /canEdit/, 'the override trigger must be gated by edit permission')
assert.match(table, /<th>หมายเหตุ<\/th>/, 'the catalog must show the item note after status')
assert.match(table, /inventory-note-cell/, 'item notes must remain visible in both catalog layouts')
assert.match(table, /inventory-action-icon/, 'the edit action must use an icon affordance')
assert.match(table, /ViewIcon/, 'the detail action must use an icon affordance')
assert.match(table, /<div className="inventory-actions">/, 'catalog actions must share an icon-only action group')
assert.match(table, /InventoryItemEditDialog/, 'the catalog edit action must open an in-page dialog')
assert.doesNotMatch(table, /href=\{`\/inventory\/\$\{item\.id\}\/edit`\}/, 'catalog edit must not navigate away')

const activeControl = read('components/inventory/InventoryItemActiveControl.tsx')
assert.match(activeControl, /PowerIcon/, 'active-state changes must use a power icon')
assert.match(activeControl, /aria-label=/, 'icon-only active-state control must remain accessible')

const editDialog = read('components/inventory/InventoryItemEditDialog.tsx')
assert.match(editDialog, /<dialog/, 'inventory edit must render as a dialog')
assert.match(editDialog, /InventoryItemForm/, 'the edit dialog must reuse the inventory form')
assert.match(editDialog, /onSaved=\{close\}/, 'saving from the dialog must close it')

const lotTable = read('components/inventory/LotTable.tsx')
assert.match(lotTable, /เลขที่ล็อต/)
assert.match(lotTable, /LOT_EXPIRY_LABELS/, 'expiry wording comes from the shared presenter')
assert.match(lotTable, /LOT_EXPIRY_TONES/, 'severity must carry a text label, not colour alone')
assert.doesNotMatch(lotTable, /จัดเก็บที่/, 'storage location is not shown on the lot table')

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
  /min="0\.5"[\s\S]{0,40}max="60"/,
  'the per-item reserve-months input must be gone now that it is a system-wide setting',
)
assert.doesNotMatch(
  editor,
  /createBrowserClient|supabase\.from/,
  'the browser must never mutate Supabase directly',
)

const settingsControl = read('components/inventory/InventoryMinimumStockSettings.tsx')
assert.match(settingsControl, /^['"]use client['"]/m)
assert.match(settingsControl, /setInventoryMinimumStockMonths/, 'the control must call the admin-only Server Action')
assert.match(settingsControl, /จำนวนเดือนสำรอง/)

const actions = read('lib/inventory/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /supabaseAdmin\.rpc\('set_inventory_minimum_stock'/)
assert.match(actions, /supabaseAdmin\.rpc\('set_inventory_minimum_stock_months'/)
assert.match(actions, /supabaseAdmin\.rpc\('record_stock_adjustment'/)
assert.match(actions, /supabaseAdmin\.rpc\('set_stock_balance'/, 'counted balances must be written through the locking RPC')
assert.match(actions, /p_lot_number/, 'the Server Action must pass the lot number to the RPC')
assert.match(actions, /p_expiry_date/, 'the Server Action must pass the expiry date to the RPC')
assert.match(actions, /assertStockOperator/, 'adjustments require an authorized stock operator')
assert.match(
  actions,
  /hasAppRole\(actor, 'admin'\)/,
  'the system-wide minimum-stock setting must be admin-only',
)

const queries = read('lib/inventory/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /createClient/, 'catalog reads stay under RLS')
assert.doesNotMatch(queries, /supabaseAdmin/, 'reads must not escalate to the service role')
assert.match(queries, /stock_movements/, 'balances come from the movement ledger')
assert.match(queries, /getInventoryMinimumStockMonths/, 'the suggested minimum must read the shared setting')
assert.match(queries, /note: row\.note/, 'the catalog record must carry the stored item note')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/inventory/, 'the shell must link to the inventory catalog')

console.log('inventory UI: ok')
