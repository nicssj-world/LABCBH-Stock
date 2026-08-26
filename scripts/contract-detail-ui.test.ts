import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const detailPage = read('app/(protected)/contracts/[id]/page.tsx')
const queries = read('lib/contracts/queries.ts')
const spendingRates = read('components/contracts/ContractSpendingRates.tsx')
const globalStyles = read('app/globals.css')
const committeeRoster = read('components/contracts/ContractCommitteeRoster.tsx')
const rosterRenderIndex = detailPage.indexOf('<ContractCommitteeRoster')
const detailContentIndex = detailPage.indexOf("{mode === 'budget' ? (")
const archiveSectionIndex = detailPage.indexOf('{isAdmin && (')

assert.match(detailPage, /remainingTotal/, 'E-Bidding detail must calculate a total remaining value')
assert.match(detailPage, /ยอดคงเหลือรวม/, 'the total remaining value needs a clear Thai label')
assert.match(detailPage, /item\.remainingQuantity/, 'each contract line must show its remaining quantity')
assert.match(detailPage, /item\.remainingValue/, 'each contract line must show its remaining value')
assert.match(detailPage, /item\.remainingPercent/, 'each contract line must expose a percentage for its remaining-balance gauge')
assert.match(detailPage, /role="progressbar"/, 'each contract line gauge must be accessible to assistive technology')
assert.match(detailPage, /ContractRemainingGauge/, 'the total remaining balance should reuse the shared gauge pattern')
assert.match(detailPage, /ContractSpendingRates/, 'the full contract detail must show the spending pace summary')
assert.match(detailPage, /actualUsed=\{actualUsed\}/, 'the spending pace summary must receive cumulative actual use')
assert.match(detailPage, /durationYears=\{contract\.contractDurationYears\}/, 'the spending pace summary must use the stored one- or three-year term')
assert.match(spendingRates, /contractSpendingRates/, 'the spending pace UI must use the shared calculation')
assert.match(spendingRates, /actualUsed/, 'the spending pace UI must calculate from actual use rather than the contract ceiling')
assert.match(spendingRates, /ยอดใช้จริงสะสม/, 'the spending pace UI must explain the actual-use calculation basis')
assert.match(spendingRates, /เฉลี่ย\/เดือน/, 'the spending pace UI must label the monthly average')
assert.match(spendingRates, /เฉลี่ย\/ปี/, 'the spending pace UI must label the annual average')
assert.match(spendingRates, /ยังไม่ได้ระบุจำนวนปีของสัญญา/, 'missing terms must explain why the pace is unavailable')
assert.match(globalStyles, /\.contract-spending-rates__grid/, 'the spending pace summary needs a dedicated responsive layout')
assert.match(detailPage, /ใช้ไป/, 'each line must explain the consumed quantity, not rely on color alone')
assert.match(queries, /contractSupplyBalance/, 'contract reads must use the shared supply balance calculation')
assert.match(queries, /allocatedQuantity/, 'contract reads must preserve the allocated quantity from the ledger')
assert.match(committeeRoster, /contract-committee-roster__empty/, 'each empty committee seat group needs a clear empty state')
assert.match(committeeRoster, /ยังไม่ได้กำหนดกรรมการ/, 'empty committee groups must explain that no member has been assigned')
assert.doesNotMatch(committeeRoster, /รายชื่อกรรมการประจำสัญญา/, 'the roster must not repeat its Thai title')
assert.match(committeeRoster, /บันทึกรายชื่อกรรมการ/, 'the save action should use clear Thai wording')
assert.doesNotMatch(committeeRoster, /บันทึก roster กรรมการ/, 'the save action should not mix Thai and English terminology')
assert.match(committeeRoster, /แก้ไขรายชื่อกรรมการ/, 'the edit action should use clear Thai wording')
assert.doesNotMatch(committeeRoster, /แก้ไข roster/, 'the edit action should not mix Thai and English terminology')
assert.ok(rosterRenderIndex > detailContentIndex, 'the committee roster should follow the contract content sections')
assert.ok(rosterRenderIndex < archiveSectionIndex, 'the committee roster should remain before admin archive controls')

// Purchase history: every "ซื้อในสัญญา" PR against a started supply contract,
// 5 most recent shown by default with a "ดูเพิ่ม" expand control.
assert.match(detailPage, /ContractPurchaseHistory/, 'a started supply contract must show its purchase history')
assert.match(
  detailPage,
  /const isStartedSupplyContract = mode === 'supply' && isContractStarted/,
  'the condition guarding the contract-only reads must stay derived in one place',
)
assert.match(
  detailPage,
  /isStartedSupplyContract \? listContractPurchaseHistory\(contract\.id\) : \[\]/,
  'purchase history must only be fetched for a started supply contract — a lease never uses the contract PR method',
)
// These reads are independent of each other once the contract's mode and stage
// are known. Awaiting them one at a time cost a separate round trip each, so
// the gate above has to keep working from inside a single Promise.all.
assert.match(
  detailPage,
  /await Promise\.all\(\[/,
  'the reads that follow the contract must overlap rather than queue',
)
assert.doesNotMatch(
  detailPage,
  /\?\s*await listContractPurchaseHistory/,
  'purchase history must not go back to being awaited on its own',
)
assert.match(detailPage, /ประวัติการซื้อ/)

const prQueries = read('lib/pr/queries.ts')
assert.match(prQueries, /export async function listContractPurchaseHistory/)
assert.match(
  prQueries,
  /\.eq\('purchase_method', 'contract'\)/,
  'purchase history must read from the same contract-drawdown PR method',
)
assert.match(
  prQueries,
  /Number\(request\.methodDetails\.contractId\) === contractId/,
  'rows must be filtered to the requested contract in JS, matching this file\'s existing methodDetails-reading convention',
)
assert.match(
  prQueries,
  /Number\(right\.methodDetails\.purchaseSequence\) - Number\(left\.methodDetails\.purchaseSequence\)/,
  'purchase history must sort newest purchase (highest sequence) first',
)

const purchaseHistoryComponent = read('components/contracts/ContractPurchaseHistory.tsx')
assert.match(purchaseHistoryComponent, /^['"]use client['"]/m)
assert.match(purchaseHistoryComponent, /VISIBLE_LIMIT = 5/, 'exactly 5 purchases show before the show-more control')
assert.match(purchaseHistoryComponent, /ยังไม่มีการซื้อภายใต้สัญญานี้/, 'an empty history needs its own explicit state')
assert.match(purchaseHistoryComponent, /ดูเพิ่มอีก/, 'the expand control must say how many more purchases exist')
assert.match(purchaseHistoryComponent, /ย่อรายการ/, 'the control must also collapse back down once expanded')
assert.doesNotMatch(
  purchaseHistoryComponent,
  /createBrowserClient|supabase\.from/,
  'the browser must never mutate or query Supabase directly',
)

// Clicking a purchase opens a summary popup of that PR's items — no extra
// fetch, since listContractPurchaseHistory already loaded every item.
assert.match(purchaseHistoryComponent, /<dialog\b/, 'a purchase summary must use the native dialog element, matching every other dialog in this app')
assert.match(purchaseHistoryComponent, /showModal\(\)/)
assert.match(purchaseHistoryComponent, /selected\.items\.map/, 'the popup must list every line item of the clicked purchase')
assert.match(purchaseHistoryComponent, /selected\.items\.length/, 'the popup must show how many items the purchase had')
assert.match(purchaseHistoryComponent, /formatBaht\(selected\.total\)/, 'the popup must show the purchase grand total')
assert.match(purchaseHistoryComponent, /formatBaht\(item\.unitPrice\)/, 'the popup must show each line\'s unit price')
assert.match(purchaseHistoryComponent, /formatBaht\(item\.lineTotal\)/, 'the popup must show each line\'s total')
assert.match(
  purchaseHistoryComponent,
  /href=\{`\/purchase-requests\/\$\{entry\.id\}`\}/,
  'each contract purchase row must expose a direct PR detail link for stock officers',
)

// Opening balance dialog: admin-only, started supply contracts only, and its
// note/date fields must carry a dedicated body class — app-dialog__body alone
// styles neither <label> nor <textarea>, which previously left the required
// note field visually blank so the submit button looked permanently disabled.
assert.match(detailPage, /OpeningBalanceDialog/, 'a started supply contract must expose the opening-balance dialog')
assert.match(
  detailPage,
  /isAdmin && isContractStarted && !record\.isArchived[\s\S]*?<OpeningBalanceDialog/,
  'the opening-balance dialog must be admin-only and require a started, non-archived contract',
)
const openingBalanceDialog = read('components/contracts/OpeningBalanceDialog.tsx')
assert.match(openingBalanceDialog, /^['"]use client['"]/m)
assert.match(openingBalanceDialog, /className="app-dialog opening-balance-dialog"/)
assert.match(
  openingBalanceDialog,
  /className="app-dialog__body opening-balance-dialog__body"/,
  'the form body needs its own styling class, not just app-dialog__body, or the note field renders without a visible box',
)
assert.match(openingBalanceDialog, /disabled=\{isPending \|\| !note\.trim\(\)\}/, 'the note field is required before submitting')

const dialogStyles = read('app/globals.css')
assert.match(
  dialogStyles,
  /\.contract-committee-roster > \.bench-panel__header > \.pr-checklist__status\s*\{[^}]*color:\s*var\(--lab-amber\)/,
  'an incomplete roster needs a visible warning treatment that stays within the shared semantic palette',
)
assert.match(
  dialogStyles,
  /\.contract-committee-roster \.pr-checklist-detail__committees section\s*\{[^}]*background:\s*var\(--lab-surface-muted\)[^}]*border:\s*1px solid var\(--lab-border\)/,
  'committee groups should read as clean flat work surfaces instead of unbounded blank columns',
)
assert.match(
  dialogStyles,
  /\.contract-committee-roster \.pr-checklist-detail__committees section\s*\{[^}]*border-left:\s*1px solid var\(--lab-border\)/,
  'committee groups should not retain the shared blue accent stripe on the left',
)
assert.match(
  dialogStyles,
  /\.contract-committee-roster \.pr-checklist-detail__committees h3\s*\{[^}]*font-size:/,
  'contract committee headings must use the detail page type hierarchy',
)
assert.match(
  dialogStyles,
  /\.opening-balance-dialog__body textarea\s*\{[^}]*border:\s*1px solid var\(--lab-border-strong\)/,
  'the note textarea must have a visible border, matching every other dialog textarea in this app',
)
assert.match(
  dialogStyles,
  /\.data-table td \.opening-balance-history__lines strong\s*\{[^}]*display:\s*inline;/,
  'the changed-item quantity override must outrank the data-table strong display rule',
)

// The note field is required before it can be recorded, so it must actually
// surface somewhere — otherwise forcing an admin to type it is pointless.
assert.match(detailPage, /listContractOpeningBalanceHistory/, 'the detail page must read back the opening-balance history it collects')
assert.match(detailPage, /ContractOpeningBalanceHistory/, 'the detail page must render the opening-balance history')
assert.match(detailPage, /openingBalanceHistoryError/, 'a failed supplementary history read must remain visible instead of looking empty')
assert.match(detailPage, /role="alert"/, 'a failed supplementary history read must be announced as an error')
assert.match(queries, /export async function listContractOpeningBalanceHistory/)
assert.match(
  queries,
  /allocation\.source_metadata\?\.previous_quantity[\s\S]*?allocation\.source_metadata\?\.target_quantity/,
  'history must read back the previous/target quantities recorded alongside each delta row',
)
assert.match(queries, /allocation\.allocation_kind !== 'opening_balance'/, 'history must exclude every other allocation kind')

const openingBalanceHistory = read('components/contracts/ContractOpeningBalanceHistory.tsx')
assert.match(openingBalanceHistory, /entry\.note/, 'each history row must show the note that was required to record it')
assert.match(openingBalanceHistory, /ยังไม่มีการบันทึกยอดใช้ก่อนเข้าระบบ/, 'an empty history needs its own explicit state')

console.log('contract detail UI: ok')
