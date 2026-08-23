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


// The restock chip used to read "N รายการต้องทำ PR" off stockLevel !== healthy.
// On production that was 117 of 172 active items, 115 of them catalogue rows
// that had never moved; on staging, 198 of 198 were of that kind. It also
// merged "nothing left" with "running low", and never looked at whether a PR
// already existed, so the number could not fall when the work was done.
assert.match(listPage, /classifyStockAlert/, 'the count must use the alert rule, not the raw stock level')
assert.doesNotMatch(
  listPage,
  /alertCount = items\.filter\(\(item\) => item\.stockLevel !== 'healthy'\)/,
  'counting every non-healthy row is what made the number unreadable',
)

// Two states, two chips: they call for different responses.
assert.match(listPage, /{depletedCount} รายการหมดคลัง/, 'an item with nothing left gets its own count')
assert.match(listPage, /{belowMinimumCount} รายการใกล้หมด/, 'an item running low gets its own count')

// The filter and the count have to agree, or the button opens a different set
// from the number that sent the requester to it.
assert.match(
  listPage,
  /const visibleItems = onlyAlerts \? alertItems : items/,
  'the alert filter must reuse the same list the count was taken from',
)
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
assert.doesNotMatch(
  detailPage,
  /ค่าที่ระบบแนะนำ|ผู้ดูแลกำหนดเอง/,
  'minimum-stock source labels must not clutter the detail page',
)
// The alias panel existed to match rows against the old Google Sheet during the
// import. The Sheet is no longer a source, so the panel is dead weight on the
// page and its query is a round trip nobody reads.
assert.doesNotMatch(
  detailPage,
  /ชื่อเรียกอื่นที่พบในข้อมูลเดิม|alias-list/,
  'the Sheet reconciliation aliases panel is retired',
)


// An item name is user data of any length — the longest titles in the app are
// here. .page-heading h1 otherwise caps the measure at 22ch, a unit calibrated
// on the width of "0" and so meaningless for Thai, which wrapped these names
// mid-title while half the row sat empty.
assert.match(
  detailPage,
  /className="page-heading page-heading--actions inventory-detail__heading"/,
  'a long item name must be free of the 22ch measure cap',
)
// Deliberately NOT page-heading--stack: that lifts the cap too, but by turning
// the header into a column, which drops the status chips and the edit control below
// the title instead of leaving them on the note's row.
assert.doesNotMatch(
  detailPage,
  /page-heading--stack/,
  'the action cluster must stay on the row, not move under the title',
)
assert.match(
  read('app/globals.css'),
  /\.inventory-detail__heading h1 \{\s*max-width: none;/,
  'the cap is lifted by a scoped rule, not by restructuring the header',
)

// The card is named for what the number triggers, not for how it was derived.
// "ขั้นต่ำที่ใช้จริง" contrasted the effective minimum with the suggested one,
// a value this page never displays — so the qualifier pointed at nothing the
// reader could see. It is also the one card in the strip that had no
// explanatory sub-line, which is where that nuance belongs.
assert.match(detailPage, /<span>จุดสั่งซื้อ<\/span>/, 'the threshold card is named by what it triggers')
assert.doesNotMatch(
  detailPage,
  /ขั้นต่ำที่ใช้จริง/,
  'the old label compared the number to a value the page never shows',
)
assert.match(
  detailPage,
  /ถึงจุดนี้หรือต่ำกว่า ควรทำ PR/,
  'the threshold card needs the sub-line every other card in the strip has',
)
// The section label and the below-minimum banner must not keep calling the
// same number something else.
assert.doesNotMatch(detailPage, /เกณฑ์ขั้นต่ำ/, 'one number, one name across the page')
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
assert.doesNotMatch(table, /ต้องทำ PR/, 'per-item purchase-request callouts must not clutter the catalog')
assert.match(table, /inventory-table--desktop/, 'desktop table variant must exist')
assert.match(table, /inventory-task-cards/, 'mobile task-card variant must exist')
assert.match(table, /คงเหลือ/)
assert.match(table, /ขั้นต่ำ/)
assert.doesNotMatch(table, /MinimumStockEditor/, 'per-item minimum editing must be removed from the catalog')
assert.doesNotMatch(table, /ค่าที่ระบบแนะนำ|กำหนดเอง/, 'minimum-stock source labels must not clutter the catalog')
assert.match(table, /<th>หมายเหตุ<\/th>/, 'the catalog must show the item note after status')
assert.match(table, /inventory-note-cell/, 'item notes must remain visible in both catalog layouts')
assert.match(table, /inventory-action-icon/, 'the edit action must use an icon affordance')
  assert.match(table, /DocumentOpenIcon/, 'the detail action must use the document icon affordance')
  assert.doesNotMatch(table, /OpenDetailIcon/, 'the inventory detail action must not use the arrow icon')
assert.match(table, /<div className="inventory-actions">/, 'catalog actions must share an icon-only action group')
assert.match(table, /InventoryItemEditDialog/, 'the catalog edit action must open an in-page dialog')
assert.doesNotMatch(table, /href=\{`\/inventory\/\$\{item\.id\}\/edit`\}/, 'catalog edit must not navigate away')

const activeControl = read('components/inventory/InventoryItemActiveControl.tsx')
assert.match(activeControl, /PowerIcon/, 'active-state changes must use a power icon')
assert.match(activeControl, /aria-label=/, 'icon-only active-state control must remain accessible')
assert.match(activeControl, /currentIsActive/, 'the active control must reflect the saved state immediately')
assert.match(activeControl, /role="alert"/, 'active-state errors must be visible to assistive technology')

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
