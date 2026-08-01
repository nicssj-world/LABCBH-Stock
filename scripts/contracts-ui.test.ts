import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const contractRoutes = [
  'app/(protected)/contracts/page.tsx',
  'app/(protected)/contracts/new/page.tsx',
  'app/(protected)/contracts/[id]/page.tsx',
  'app/(protected)/contracts/[id]/edit/page.tsx',
]

for (const route of contractRoutes) {
  assert.ok(read(route).length > 0, `${route} must exist`)
}

const listPage = read(contractRoutes[0])
assert.match(listPage, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(listPage, /listContracts\(/, 'contract list must read on the server')
assert.match(listPage, /ปีงบประมาณ/, 'contract list must group by fiscal year')

const detailPage = read(contractRoutes[2])
assert.match(detailPage, /params:\s*Promise</, 'Next 16 detail params must be awaited')
assert.match(detailPage, /StageTimeline/, 'detail must show six-step history')
assert.match(detailPage, /StageAdvanceControl/, 'detail must expose confirmed stage advance')
assert.match(detailPage, /contract\.procurementStage\s*===\s*['"]contract_started['"]/, 'started contracts must use a dedicated completed state')
assert.match(detailPage, /isContractStarted\s*\?\s*\(/, 'started contracts must branch to collapsed history')
assert.match(detailPage, /!isContractStarted\s*&&[\s\S]*StageAdvanceControl/, 'started contracts must not render the next action')
assert.match(detailPage, /className="route-stack contract-detail-page"/, 'contract detail must use its focused control-sheet surface')
assert.match(detailPage, /contract-detail-heading__top/, 'contract identity must keep navigation, state, and edit action together')
assert.match(detailPage, /contract-detail-heading__value/, 'contract value must be the primary summary metric')
assert.match(detailPage, /<dl className="contract-facts"/, 'supporting facts must stay grouped inside the contract overview')
assert.match(detailPage, /<StatusChip tone="neutral">\{contract\.contractTypeLabel\}<\/StatusChip>/, 'contract type must be a neutral category badge, distinct from workflow status')
assert.match(detailPage, /<StatusChip tone="info">\{contract\.procurementStageLabel\}<\/StatusChip>/, 'detail must distinguish the procurement stage from contract status')
assert.match(detailPage, /\{contract\.contractStatusLabel\}/, 'detail must name the effective contract status')
assert.match(detailPage, /ExpireContractDialog/, 'editors must be able to record an exceptional contract expiry')
assert.match(detailPage, /canEdit\s*&&\s*\([\s\S]*<ContractEditDialog/, 'editors must open the real edit form from a popup')
assert.doesNotMatch(detailPage, /href=\{`\/contracts\/\$\{contract\.id\}\/edit`\}>แก้ไขข้อมูล/, 'detail must not navigate away when edit is clicked')
assert.match(detailPage, /const isAdmin = hasAppRole\(actor, ['"]admin['"]\)/, 'responsible-user management must be gated to admins')
assert.match(detailPage, /mode === ['"]budget['"] && isAdmin[\s\S]*<ResponsibleUserDialog/, 'lease admins must get the responsible-user dialog beside header actions')
assert.match(detailPage, /isAdmin\s*&&\s*<ArchiveContractControl/, 'only administrators may access the duplicate-or-mistake archive control')

const archiveControl = read('components/contracts/ArchiveContractControl.tsx')
assert.match(archiveControl, /เก็บรายการที่สร้างผิดหรือซ้ำ/, 'archive wording must distinguish cleanup from contract expiry')
assert.doesNotMatch(archiveControl, /ยกเลิกและเก็บสัญญาถาวร/, 'archive wording must not compete with the expiry action')

const budgetPanel = read('components/contracts/BudgetPanel.tsx')
assert.doesNotMatch(budgetPanel, /ResponsibleUserPicker|ผู้รับผิดชอบสัญญา/, 'responsible users must not occupy the contract detail flow')
assert.match(budgetPanel, /ExpenseMonthlyChart/, 'lease detail must show an accessible month-by-month expense bar chart')

const responsibleDialog = read('components/contracts/ResponsibleUserDialog.tsx')
assert.match(responsibleDialog, /^['"]use client['"]/m, 'responsible-user popup must be an interactive client boundary')
assert.match(responsibleDialog, /showModal\(\)/, 'admin trigger must open a modal dialog')
assert.match(responsibleDialog, /<dialog/, 'responsible-user manager must use the native accessible dialog')
assert.match(responsibleDialog, /ResponsibleUserPicker/, 'popup must preserve the real responsible-user picker')
assert.match(responsibleDialog, /key=\{pickerSession\}/, 'reopening the popup must discard unsaved local choices')
assert.match(responsibleDialog, /onSaved=\{closeDialog\}/, 'successful saving must close the popup')
assert.match(responsibleDialog, /aria-label="ปิดหน้าต่างกำหนดผู้รับผิดชอบ"/, 'popup must expose a clear close control')

const responsiblePicker = read('components/contracts/ResponsibleUserPicker.tsx')
assert.match(responsiblePicker, /onSaved\?\.\(\)/, 'responsible-user picker must notify the popup after a successful save')

const form = read('components/contracts/ContractForm.tsx')
const editDialog = read('components/contracts/ContractEditDialog.tsx')
assert.match(editDialog, /^['"]use client['"]/m, 'contract edit popup must be an interactive client boundary')
assert.match(editDialog, /showModal\(\)/, 'edit trigger must open a modal dialog')
assert.match(editDialog, /className="app-dialog app-dialog--wide"/, 'edit popup must use the centered wide-dialog surface')
assert.match(editDialog, /<ContractForm/, 'edit popup must reuse the real contract form')
assert.match(editDialog, /onCancel=\{requestClose\}/, 'form cancellation must use the popup close guard')
assert.match(editDialog, /onSaved=\{handleSaved\}/, 'successful editing must close the popup')
assert.match(editDialog, /window\.confirm/, 'closing a dirty edit popup must require confirmation')

assert.match(form, /onCancel\?:\s*\(\)\s*=>\s*void/, 'contract form must support popup cancellation')
assert.match(form, /onSaved\?:\s*\(\)\s*=>\s*void/, 'contract form must report successful modal editing')
assert.match(form, /onDirtyChange\?:\s*\(dirty:\s*boolean\)\s*=>\s*void/, 'contract form must expose dirty state to the close guard')
assert.match(form, /onSaved\?\.\(\)/, 'contract form must notify the popup after a successful edit')

const globalStyles = read('app/globals.css')
assert.match(globalStyles, /\.app-dialog\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*margin:\s*auto;/, 'application popups must stay centered in the viewport')

const expenseHistory = read('components/contracts/ExpenseHistory.tsx')
assert.match(expenseHistory, /expense-history__exports/, 'CSV and Excel exports must be grouped as one coherent toolbar')
assert.match(expenseHistory, /aria-label="ดาวน์โหลดประวัติการใช้จ่าย"/, 'export actions need an accessible group label')
assert.match(expenseHistory, /const \[displayLimit, setDisplayLimit\]/, 'expense history must let users choose how many records to view')
assert.match(expenseHistory, /value=\{displayLimit\}/, 'the selected display count must remain visible')
assert.match(expenseHistory, /10 รายการ|20 รายการ|50 รายการ/, 'the display count selector must offer useful recent-record limits')
assert.match(expenseHistory, /displayedEntries\.map/, 'the table must render only the selected number of records')

const expenseForm = read('components/contracts/ExpenseForm.tsx')
assert.match(expenseForm, /expense-form__primary/, 'expense entry must group month and amount as the primary two-column decision')
assert.match(expenseForm, /expense-form__secondary/, 'record date and note must remain secondary details')
assert.match(expenseForm, /aria-invalid=\{overRemaining\}/, 'the amount field must expose an over-budget warning accessibly')
assert.match(expenseForm, /expense-form__budget-alert/, 'the remaining-budget warning needs a dedicated, findable treatment')
assert.match(expenseForm, /const \[open, setOpen\]/, 'expense entry must support an intentional show/hide state')
assert.match(expenseForm, /aria-expanded=\{open\}/, 'the show/hide control must expose its expanded state')
assert.match(expenseForm, /expense-entry__toggle/, 'expense entry needs a clear toggle control')
assert.match(expenseForm, /open && \(/, 'the expense form contents must be conditionally revealed')

const budgetGauge = read('components/contracts/BudgetGauge.tsx')
assert.match(budgetGauge, /budget-gauge__figures/, 'budget summary must retain the grouped three-figure display next to expense entry')
assert.match(globalStyles, /\.expense-form__primary input,[\s\S]*border:\s*1px solid var\(--lab-border-strong\)/, 'expense entry fields must retain visible input boundaries')
assert.match(globalStyles, /\.expense-form__primary label\s*\{[\s\S]*align-content:\s*start;/, 'month and amount inputs must align at the top when amount shows a helper line')

const fileCard = read('components/contracts/ContractFileCard.tsx')
assert.match(fileCard, /contract-file-control--view/, 'an uploaded contract must expose a compact view icon')
assert.match(fileCard, /aria-label="เปิดดูไฟล์สัญญา"/, 'file view icon needs an accessible label')
assert.match(fileCard, /<dialog/, 'contract preview must open in an in-page dialog')
assert.match(fileCard, /<iframe/, 'contract preview must render inside the current page')

const historyDisclosure = read('components/contracts/StageHistoryDisclosure.tsx')
assert.match(historyDisclosure, /^['"]use client['"]/m, 'history disclosure must be an interactive client boundary')
assert.match(historyDisclosure, /aria-expanded=\{open\}/, 'history disclosure must expose its expanded state')
assert.match(historyDisclosure, /aria-controls=\{historyId\}/, 'history disclosure must connect the button to its content')
assert.match(historyDisclosure, /ดูประวัติขั้นตอนสัญญา/, 'collapsed history must have a clear Thai action label')
assert.match(historyDisclosure, /ซ่อนประวัติขั้นตอนสัญญา/, 'expanded history must have a clear Thai action label')
assert.match(historyDisclosure, /stage-history-toggle__glyph/, 'history disclosure must have a recognizable audit-trail glyph')
assert.match(historyDisclosure, /ข้อมูลย้อนหลังและวันที่มีผล/, 'history disclosure must explain what it reveals')

const expiryDialog = read('components/contracts/ExpireContractDialog.tsx')
assert.match(expiryDialog, /expireContract/, 'expiry control must persist through the dedicated Server Action')
assert.match(expiryDialog, /showModal\(\)/, 'manual expiry must require a deliberate popup confirmation')
assert.match(expiryDialog, /เหตุผลที่สิ้นสุดสัญญา/, 'manual expiry must retain a reason for audit')

assert.match(form, /^['"]use client['"]/m, 'only the interactive form is a client boundary')
assert.match(form, /createContract|updateContract/, 'form must call typed Server Actions')
assert.match(form, /localStorage/, 'form must autosave a local draft')
assert.match(form, /beforeunload/, 'form must warn before leaving an unsaved draft')
assert.doesNotMatch(form, /createBrowserClient|supabase\.from/, 'browser form must not mutate Supabase')

const itemsEditor = read('components/contracts/ContractItemsEditor.tsx')
assert.match(itemsEditor, /ยอดรวมทั้งสัญญา/, 'item editor must expose a grand total')
assert.match(itemsEditor, /item\.id/, 'edit rows must preserve stable item IDs')

const table = read('components/contracts/ContractTable.tsx')
assert.match(table, /contract-table--desktop/, 'desktop table variant must exist')
assert.match(table, /contract-task-cards/, 'mobile task-card variant must exist')
assert.match(table, /contractListValue\(contract\)/, 'the register must use the recorded contract total, including legacy contracts without item rows')
assert.doesNotMatch(table, /items\.reduce/, 'the register must not turn legacy totals into zero by summing absent item rows')
assert.match(table, /<th>สถานะสัญญา<\/th>/, 'the register must name the contract status explicitly')
assert.match(table, /\{contract\.contractStatusLabel\}/, 'the red status chip must say expired or cancelled, not the procurement stage')
assert.match(table, /\{contract\.procurementStageLabel\}/, 'the procurement stage must remain visible separately from status')

const dashboardPage = read('app/(protected)/dashboard/page.tsx')
assert.match(dashboardPage, /getExecutiveDashboard/, 'dashboard must use a real SSR\/RLS read boundary')
assert.match(dashboardPage, /รายการที่ต้องเฝ้าระวัง/, 'Composition C must lead with a watchlist')
assert.match(dashboardPage, /มูลค่าคงเหลือในสัญญา/, 'dashboard must show remaining contract value')
assert.doesNotMatch(dashboardPage, /minimum stock/i, 'stock-ledger alert stays out until Milestone 4')

const dashboardData = read('lib/dashboard/contracts.ts')
assert.match(dashboardData, /quantity\s*-\s*allocatedQuantity/, 'remaining quantity must use the allocation ledger')
assert.match(dashboardData, /remainingPercent\s*<\s*30/, 'watchlist threshold must be below 30%')
assert.match(dashboardData, /createClient/, 'dashboard reads must use authenticated SSR Supabase')
assert.doesNotMatch(dashboardData, /supabaseAdmin/, 'dashboard reads must stay under RLS')

console.log('contract UI and executive dashboard contract ok')
