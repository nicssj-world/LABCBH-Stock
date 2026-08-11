import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const listPage = read('app/(protected)/purchase-requests/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(listPage, /listPurchaseRequests\(/)
assert.match(listPage, /ค้นหา/, 'stock officers search by PO, PR, LS code, or name')
assert.match(listPage, /หน่วยงาน/, 'stock officers can filter purchase requests by department')
assert.match(listPage, /AutoFilterBench/, 'purchase-request filters must update the list immediately')
assert.doesNotMatch(listPage, /แสดงผล/, 'purchase-request filters must not require an apply button')
assert.match(listPage, /PurchaseRequestTable/)
assert.doesNotMatch(listPage, /^['"]use client['"]/m)

const newPage = read('app/(protected)/purchase-requests/new/page.tsx')
assert.match(newPage, /PurchaseRequestForm/)
assert.match(newPage, /DEPARTMENTS/)
assert.match(newPage, /departments=\{DEPARTMENTS\}/)
assert.match(newPage, /listNextContractPurchaseSequences/)
assert.match(newPage, /awaitingContracts/, 'awaiting_contract offers contracts still moving through the procurement stages')
assert.match(newPage, /effectiveContractStatus/, 'an ended contract must not appear as choosable for ordinary drawdown')
assert.match(newPage, /effectiveContractStatus\(contract\.status, contract\.endDate\) === 'active'/, 'only an active contract can be ordered against')
assert.match(newPage, /effectiveContractStatus\(contract\.status, contract\.endDate\) === 'pending'/, 'only a pending contract can be referenced while awaiting procurement')
assert.match(newPage, /procurementStage === 'contract_started'/, 'only a started contract can be ordered against')
assert.match(newPage, /contractType !== 'equipment_lease'/, 'a lease has no line items to draw down')
assert.match(newPage, /assertPurchaseRequester|canRequestPurchase/, 'only heads and admins may draft a PR')

const detailPage = read('app/(protected)/purchase-requests/[id]/page.tsx')
assert.match(detailPage, /params:\s*Promise</)
assert.match(detailPage, /PrReviewPanel/)
assert.match(detailPage, /canOperateStock/, 'only stock officers and admins confirm')
assert.match(detailPage, /contract-detail-heading__top/, 'the PR header reuses the same identity/status layout as the contract detail page')
assert.match(detailPage, /contract-detail-heading__value/, 'มูลค่ารวม must be the primary summary metric, not just another fact in the list')
assert.match(detailPage, /<dl className="contract-facts/, 'supporting facts must use the bordered fact grid, not an unstyled list')
assert.match(detailPage, /contract-facts--split-with-value/, 'the last fact column must align under the value panel above it, not just sit near it')
assert.match(detailPage, /bench-panel--decision/, 'the stock officer panel must read as an outstanding decision while a PR is pending')
assert.match(detailPage, /request\.status === 'pending' \? 'bench-panel bench-panel--decision' : 'bench-panel'/, 'the decision tone must clear once the PR is no longer pending, not stay on a closed record')

const form = read('components/pr/PurchaseRequestForm.tsx')
assert.match(form, /^['"]use client['"]/m)
assert.match(form, /createPurchaseRequest/)
assert.match(form, /PurchaseMethodFields/)
assert.match(form, /ContractItemPicker/)
assert.match(form, /departments: readonly string\[\]/)
assert.match(form, /<select required value=\{department\}/)
assert.match(form, /\{departments\.map\(\(department\)/)
assert.doesNotMatch(form, /<input type="text" required value=\{department\}/)
assert.match(form, /หัวหน้างาน/, 'the requester header labels the supervisor as หัวหน้างาน')
assert.match(form, /ยอดในสัญญาจะถูกตัดเมื่อเจ้าหน้าที่คลังยืนยันเท่านั้น/)
assert.match(form, /<span>ยอดรวม<\/span>/)
assert.doesNotMatch(form, /ยอดรวมทั้งใบ PR/)
assert.doesNotMatch(form, /createBrowserClient|supabase\.from/)
assert.match(
  form,
  /if \(candidate\.kind === 'contract'\) \{/,
  'opening a new contract (specific_contract/e_bidding) must pick from the full catalogue, not a contract\'s remaining lines',
)
assert.match(form, /optionsFor\(next\)/, 'selecting a contract must auto-fill its remaining lines, not just clear the picker')
assert.match(
  form,
  /method\.kind !== 'contract' && !isLease && \([\s\S]*?SELECT ITEMS/,
  'the item picker must hide once a contract auto-fills the request lines, and for a lease which has no reagent lines at all',
)
assert.match(
  form,
  /method\.kind === 'contract'\s*\?\s*'กรุณาเลือกสัญญาก่อน/,
  'the empty request-lines state must point at picking a contract, since the item picker is no longer visible to explain itself',
)
assert.match(form, /จุดประสงค์และวิธีจัดซื้อ/)
assert.match(form, /isOverContractLimit/, 'requesting more than a contract line has left must be caught before submit')
assert.match(form, /isLowContractBalance/, 'a line under 30% remaining must be flagged, matching the dashboard watchlist threshold')
assert.match(
  form,
  /disabled=\{isPending \|\| \(!isLease && lines\.length === 0\) \|\| methodSelectionMissing \|\| hasOverLimitLine\}/,
  'submit must stay blocked while any line exceeds its contract remaining, but a lease with zero lines must still be submittable',
)
assert.match(form, /const isLease = method\.kind === 'equipment_lease'/, 'a lease originates a contract with zero line items')
assert.match(form, /คงเหลือในสัญญา/, 'the request-lines table must show each line\'s remaining contract balance')
assert.match(form, /changeDepartment/, 'changing the requesting department must re-filter its contract lists')
assert.match(form, /changePurpose/)
assert.match(form, /aria-live="polite"/, 'clearing picked lines on a method/department change must be announced')
assert.match(form, /methodSelectionMissing/, 'the form must know when there is nothing to select and disable submit')

const styles = read('app/globals.css')
assert.match(
  styles,
  /\.bench-panel > \.form-grid\s*\{[\s\S]*?padding:\s*20px;[\s\S]*?\}/,
  'form fields inside a panel need inset space from the panel border',
)
assert.match(
  styles,
  /\.method-detail-grid select\s*\{[\s\S]*?border:\s*1px solid var\(--lab-border-strong\);[\s\S]*?\}/,
  'the contract selector needs the same visible border as other method fields',
)
assert.match(
  styles,
  /\.bench-panel > \.items-editor__grand-total\s*\{[\s\S]*?margin:\s*18px 20px 20px;[\s\S]*?\}/,
  'the PR total needs inset space from the panel edge',
)
assert.match(
  styles,
  /\.data-table input\s*\{[\s\S]*?border:\s*1px solid var\(--lab-border-strong\);[\s\S]*?\}/,
  'quantity/price inputs inside a data-table must render a visible border, not rely on the bare browser default',
)
assert.match(styles, /\.pr-review__identifier-field\s*\{[^}]*width:\s*min\(100%, 520px\)/, 'PR and PO identifiers should not stretch across the full review card')
assert.match(styles, /\.pr-review__identifier-field input:read-only\s*\{[^}]*background:\s*color-mix/, 'saved PR and PO identifiers should have a muted filled-state background')
assert.match(styles, /\.pr-review__number-action\s*\{[^}]*min-width:\s*220px/, 'identifier actions should size to their label instead of stretching')

const methodFields = read('components/pr/PurchaseMethodFields.tsx')
assert.match(methodFields, /PURCHASE_METHOD_LABELS/, 'the six methods come from the shared presenter')
assert.match(methodFields, /PURCHASE_PURPOSE_LABELS/, 'the purpose fork has its own labels')
assert.match(methodFields, /PURCHASE_METHODS_BY_PURPOSE\[purpose\]/, 'only the current purpose\'s methods are offered')
assert.match(methodFields, /planSequence/)
assert.match(methodFields, /purchaseSequence/)
assert.match(methodFields, /readOnly/)
assert.match(methodFields, /contractId: 0,[\s\S]*?purchaseSequence: 1/, 'a contract method must start unselected — auto-picking contracts[0] would silently auto-fill the wrong contract')
assert.match(methodFields, /<option value=\{0\} disabled>เลือกสัญญา<\/option>/, 'the contract dropdown must show an explicit placeholder, not silently pre-pick one')
assert.match(methodFields, /awaitingContracts/)
assert.match(methodFields, /method\.kind === 'e_bidding'/)
assert.match(methodFields, /method\.kind === 'equipment_lease'/, 'a lease method gets its own ceiling field')
assert.match(methodFields, /contractDraft/, 'specific_contract/e_bidding draft a new contract inline')
assert.match(methodFields, /contractTypeForMethod/, 'the auto-filled contract type is shown, not asked for')
assert.match(
  methodFields,
  /ยังไม่มีสัญญาที่เริ่มใช้แล้ว|ยังไม่มีสัญญาที่อยู่ระหว่างดำเนินการ/,
  'an empty contract dropdown must explain why and how to proceed, not offer a dead selection',
)

const picker = read('components/pr/ContractItemPicker.tsx')
assert.match(picker, /คงเหลือในสัญญา/, 'the picker must show remaining contracted quantity')
assert.match(picker, /ยอดคงเหลือในคลัง/, 'and current on-hand, so nothing is retyped')
assert.match(picker, /เบิกเฉลี่ย/, 'and rolling usage')
assert.match(picker, /type="search"/, 'eligible items must be gated behind a search box, not dumped in full — some purchase methods make the whole catalogue eligible')
assert.match(picker, /normalizedQuery/, 'the list stays empty until the requester types a query')

const review = read('components/pr/PrReviewPanel.tsx')
assert.match(review, /^['"]use client['"]/m)
assert.match(review, /confirmPurchaseRequest/)
assert.match(review, /คงเหลือหลังยืนยัน/, 'the officer sees contract balance before and after')
assert.match(review, /contractTypeForMethod/, 'confirming a specific_contract\/e_bidding PR shows the contract it will open')
assert.match(review, /ยืนยันและสร้างสัญญา/, 'the button must name its irreversible consequence, not just say "confirm"')
assert.match(review, /วันที่ส่งพัสดุ/, 'the stock officer supplies the real ส่งพัสดุ date at confirm time')
assert.match(review, /confirmPurchaseRequest\(request\.id, sentToProcurementDate\)/)
assert.match(
  review,
  /!contractType && \(\s*<label className="field-row(?: [^"]*)?">\s*เลขที่ใบสั่งซื้อ/,
  'a contract-originating PR opens a contract directly and never becomes a purchase order, so it must not show a PO number field',
)
assert.match(review, /formatThaiDateTime/, 'audit lines must show a full date and time, not just a date')
assert.match(review, /ยืนยันโดย.*acknowledgedByName/, 'a completed or reversed PR must name who confirmed it')
assert.match(review, /กลับรายการโดย.*reversedByName/, 'a reversed PR must name who reversed it, distinct from who confirmed it')
assert.match(review, /บันทึกเลขที่ใบสั่งซื้อโดย.*updatedByName/, 'recording a PO number must be attributed too')
assert.match(review, /pr-review__meta/, 'audit lines live inside the officer action panel, not the requester-facing method detail')
assert.match(review, /const \[isEditingPoNumber, setIsEditingPoNumber\] = useState\(!request\.poNumber\)/, 'a saved PO number starts locked')
assert.match(review, /readOnly=\{!isEditingPoNumber\}/, 'a saved PO number must be read-only until edit is requested')
assert.match(review, /if \(!isEditingPoNumber\) \{[\s\S]*?setIsEditingPoNumber\(true\)/, 'the PO action must unlock the field before editing')
assert.match(review, /setIsEditingPoNumber\(false\)/, 'saving an edited PO number must lock the field again')
assert.match(review, /แก้ไขเลขที่ใบสั่งซื้อ/, 'the locked PO action must offer an explicit edit label')
assert.match(review, /pr-review__identifier-field/, 'PR and PO identifiers use the compact field treatment')
assert.match(review, /pr-review__number-action/, 'identifier actions use the compact button treatment')

const presenter = read('lib/pr/presenter.ts')
assert.match(presenter, /ซื้อในแผนทั้งปี/)
assert.match(presenter, /ซื้อในสัญญา/)
assert.match(presenter, /นอกแผน/)
assert.match(presenter, /ซื้อเจาะจงระหว่างรอสัญญา/)
assert.match(presenter, /ทำสัญญาเจาะจง/)
assert.match(presenter, /เช่าเครื่อง/, 'a lease PR method needs its own label')
assert.match(presenter, /PURCHASE_PURPOSE_LABELS/, 'the purpose fork needs its own labels, distinct from the method labels')
assert.match(presenter, /ทำใบ PR เพื่อสั่งซื้อ/)
assert.match(presenter, /ทำใบ PR เพื่อเริ่มสัญญาใหม่/)
assert.match(presenter, /ต่ำกว่าขั้นต่ำ|ควรทำ PR/, 'minimum-stock warning wording lives with the labels')

const actions = read('lib/pr/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /supabaseAdmin\.rpc\('create_purchase_request'/)
assert.match(actions, /supabaseAdmin\.rpc\('confirm_purchase_request'/)
assert.match(actions, /p_sent_to_procurement_date/, 'confirming a contract-opening PR must carry its ส่งพัสดุ date')
assert.match(actions, /supabaseAdmin\.rpc\('reverse_purchase_request'/)
assert.match(actions, /supabaseAdmin\.rpc\('set_purchase_order_number'/)
assert.match(actions, /assertPurchaseRequester/)
assert.match(actions, /assertStockOperator/)

const queries = read('lib/pr/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /createClient/)
assert.match(queries, /department\?: string/, 'purchase-request queries accept a department filter')
assert.match(queries, /filters\.department/, 'purchase-request queries apply the department filter')
assert.match(queries, /listNextContractPurchaseSequences/)
assert.match(queries, /created_contract_id/, 'a confirmed PR must link forward to the contract it opened')
assert.doesNotMatch(queries, /supabaseAdmin/, 'PR reads stay under RLS')

const table = read('components/pr/PurchaseRequestTable.tsx')
assert.match(table, /PurchaseRequestSummaryDialog request=\{request\}/, 'the desktop row must open the mini summary popup, not a plain cell')
assert.match(table, /PurchaseRequestSummaryDialog request=\{request\} variant="card"/, 'the mobile card must open the same popup')
assert.match(table, /ดูรายละเอียด/, 'the trailing detail link must remain alongside the new popup trigger')

const summaryDialog = read('components/pr/PurchaseRequestSummaryDialog.tsx')
assert.match(summaryDialog, /^['"]use client['"]/m)
assert.match(summaryDialog, /<dialog\b/, 'must use the native dialog element')
assert.match(summaryDialog, /showModal\(\)/, 'the trigger must open it via showModal')
assert.match(summaryDialog, /list-summary-dialog/)
assert.match(summaryDialog, /StatusChip tone=\{PURCHASE_REQUEST_STATUS_TONES/, 'status must never be a bare colored word')
assert.match(summaryDialog, /createdContractId/, 'a PR that opened a contract must link to it from the popup')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/purchase-requests/)

console.log('purchase request UI: ok')
