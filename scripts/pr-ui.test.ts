import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const listPage = read('app/(protected)/purchase-requests/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(listPage, /listPurchaseRequests\(/)
assert.match(listPage, /ค้นหา/, 'stock officers search by PO, PR, LS code, or name')
assert.match(listPage, /หน่วยงาน/, 'stock officers can filter purchase requests by department')
assert.match(listPage, /AutoFilterBench/, 'purchase-request filters must update the list immediately')
assert.match(listPage, /PURCHASE_REQUEST_FILTER_STATUSES/, 'the PR status filter must use one option for the shared cancellation label')
assert.match(listPage, /name: 'purchaseMethod'/, 'the PR register must expose a purchase-method filter')
assert.match(listPage, /PURCHASE_METHODS\.map/, 'the purchase-method filter must use the shared method allowlist')
assert.match(listPage, /PURCHASE_METHOD_LABELS\[value\]/, 'the purchase-method filter must show shared method labels')
assert.match(listPage, /showClear=\{false\}/, 'the PR register must not show a clear-filters button')
assert.doesNotMatch(listPage, /PURCHASE_REQUEST_STATUSES\.map/, 'the PR status filter must not render internal lifecycle statuses directly')
assert.match(listPage, /showHiddenStatuses/, 'the PR register must persist its hidden-terminal-status visibility state')
assert.match(listPage, /DEFAULT_HIDDEN_STATUS_VALUES/, 'the PR register must hide received and cancelled rows by default')
assert.match(listPage, /แสดงรายการรับครบและยกเลิก/, 'the PR register must provide a button to show hidden terminal rows')
assert.match(listPage, /ซ่อนรายการรับครบและยกเลิก/, 'the PR register visibility button must be reversible')
assert.doesNotMatch(listPage, /แสดงผล/, 'purchase-request filters must not require an apply button')
assert.match(listPage, /PurchaseRequestTable/)
assert.doesNotMatch(listPage, /^['"]use client['"]/m)

const newPage = read('app/(protected)/purchase-requests/new/page.tsx')
assert.match(newPage, /PurchaseRequestForm/)
assert.match(newPage, /DEPARTMENTS/)
assert.match(newPage, /const requesterDepartment = actor\.department\?\.trim\(\) \|\| null/, 'new PRs start in the logged-in requester department')
assert.match(newPage, /const departments =/, 'a profile department outside the shared list must still be selectable')
assert.match(newPage, /department=\{requesterDepartment \?\? DEPARTMENTS\[0\]\}/, 'new PRs fall back only when the profile has no department')
assert.match(newPage, /departments=\{departments\}/)
assert.match(newPage, /assertPurchaseRequester|canRequestPurchase/, 'only heads and admins may draft a PR')

const formOptions = read('lib/pr/form-options.ts')
assert.match(formOptions, /listNextContractPurchaseSequences/)
assert.match(formOptions, /awaitingContracts/, 'awaiting_contract offers contracts still moving through the procurement stages')
assert.match(formOptions, /effectiveContractStatus/, 'an ended contract must not appear as choosable for ordinary drawdown')
assert.match(formOptions, /effectiveContractStatus\(contract\.status, contract\.endDate\) === 'active'/, 'only an active contract can be ordered against')
assert.match(formOptions, /effectiveContractStatus\(contract\.status, contract\.endDate\) === 'pending'/, 'only a pending contract can be referenced while awaiting procurement')
assert.match(formOptions, /procurementStage === 'contract_started'/, 'only a started contract can be ordered against')
assert.match(formOptions, /contractType !== 'equipment_lease'/, 'a lease has no line items to draw down')

const detailPage = read('app/(protected)/purchase-requests/[id]/page.tsx')
assert.match(detailPage, /params:\s*Promise</)
assert.match(detailPage, /PrReviewPanel/)
assert.match(detailPage, /request\.status === 'partially_received'/, 'partial PRs must expose the continue-receiving action')
assert.match(detailPage, /purchaseRequestId=\$\{encodeURIComponent\(request\.id\)\}/, 'continue receiving must deep-link the selected PR')
assert.match(detailPage, /PurchaseRequestLifecycleControls/, 'pending PRs expose edit and cancel controls')
assert.match(detailPage, /canManagePurchaseRequest\(actor, request\.requesterId\) && request\.status === 'pending'/)
assert.match(detailPage, /canOperateStock/, 'only stock officers and admins confirm')
assert.match(detailPage, /contract-detail-heading__top/, 'the PR header reuses the same identity/status layout as the contract detail page')
assert.match(detailPage, /contract-detail-heading__value/, 'มูลค่ารวม must be the primary summary metric, not just another fact in the list')
assert.match(detailPage, /<dl className="contract-facts/, 'supporting facts must use the bordered fact grid, not an unstyled list')
assert.match(detailPage, /contract-facts--split-with-value/, 'the last fact column must align under the value panel above it, not just sit near it')
assert.match(detailPage, /bench-panel--decision/, 'the stock officer panel must read as an outstanding decision while a PR is pending')
assert.match(detailPage, /request\.status === 'pending' \? 'bench-panel bench-panel--decision' : 'bench-panel'/, 'the decision tone must clear once the PR is no longer pending, not stay on a closed record')
assert.match(detailPage, /item\.receivedQuantity/, 'each PR line must show the posted quantity received so far')
assert.match(detailPage, /item\.remainingQuantity/, 'each PR line must show how much can still be received')
assert.match(detailPage, /request\.receiptHistory\.map/, 'the PR detail page must show every linked receipt')
assert.match(detailPage, /GOODS_RECEIPT_STATUS_LABELS/, 'receipt history must identify draft, posted, and cancelled receipts')
assert.match(detailPage, /receipt\.items\.map/, 'receipt history must show every received line')
assert.match(detailPage, /item\.lotNumber/, 'receipt history must show the lot for each received line')
assert.match(detailPage, /item\.quantity/, 'receipt history must show the quantity for each received line')
assert.doesNotMatch(detailPage, /totalQuantity|จำนวนในใบรับ|รวมที่รับ/, 'PR receipt history must avoid mixed-unit aggregate totals')
assert.match(detailPage, /item\.expiryDate/, 'receipt history must show the expiry date for each received line')
assert.match(detailPage, /pr-receipt-history__items/, 'receipt lines must be grouped inside each receipt history row')
assert.doesNotMatch(detailPage, /<PurchaseRequestPoFileCard/, 'the PR header must not own PO upload controls')
assert.match(detailPage, /PurchaseRequestPoFileOpenButton/, 'the PR summary exposes the open action for an attached PO')
assert.match(detailPage, /request\.poFile\.path && !request\.poFile\.deletedAt/, 'the PR summary only exposes active attached PO files')
assert.match(detailPage, /contract-facts__po-value/, 'the PO open action stays beside the PO number in the summary fact')
assert.match(detailPage, /document-open-button/, 'the created contract action uses the same rectangular open-button treatment')
assert.match(detailPage, /<DocumentOpenIcon/, 'the created contract action uses the same document icon as the PO action')

const reviewPanel = read('components/pr/PrReviewPanel.tsx')
assert.match(reviewPanel, /pr-review__section/, 'stock officer actions need named working regions')
assert.match(reviewPanel, /pr-review__identifier-row/, 'E-Phis input and action need one aligned working row')
assert.match(
  reviewPanel,
  /<label className="field-row pr-review__identifier-field">[\s\S]*?className="[^"]*pr-review__identifier-label[^"]*"[\s\S]*?เลข PR จาก E-Phis[\s\S]*?className="[^"]*pr-review__identifier-audit[^"]*"[\s\S]*?<\/label>\s*<div className="pr-review__identifier-actions">/,
  'the saved-by attribution must continue after the E-Phis label while the action keeps its existing column',
)
assert.match(reviewPanel, /pr-review__confirm-zone/, 'confirmation needs a distinct action zone')
assert.match(reviewPanel, /pr-review__blocker/, 'confirmation blockers need to sit beside the action')
assert.match(reviewPanel, /!checklistReadyForConfirmation/, 'the existing checklist readiness guard must remain in place')
assert.match(
  reviewPanel,
  /pr-review__blocker[\s\S]*pr-review__confirm-zone[\s\S]*ยืนยันใบ PR/,
  'the blocker and confirmation action must be rendered in the same flow',
)

const poFileCard = read('components/pr/PurchaseRequestPoFileCard.tsx')
assert.match(poFileCard, /po-file-card--inline/, 'the PO file card supports the inline PR fact treatment')
assert.match(poFileCard, /compact/, 'the inline PO file action uses a compact dropzone')
assert.match(poFileCard, /PurchaseRequestPoFileOpenButton/, 'the lower PO card reuses the shared PO open action')

const poFileOpenButton = read('components/pr/PurchaseRequestPoFileOpenButton.tsx')
assert.match(poFileOpenButton, /export function PurchaseRequestPoFileOpenButton/, 'the PO open action owns its private preview dialog')
assert.match(poFileOpenButton, /document-open-button/, 'the PO open action uses the shared rectangular open-button treatment')
assert.match(poFileOpenButton, /variant="secondary"/, 'the PO open action keeps the same secondary button treatment in every PR view')
assert.match(poFileOpenButton, /DocumentOpenIcon/, 'the PO open action uses the shared document icon')
assert.match(poFileOpenButton, /api\/purchase-requests\/\$\{encodeURIComponent\(requestId\)\}\/po-file/, 'the PO open action requests a private preview URL')

const poFileRoute = read('app/api/purchase-requests/[id]/po-file/route.ts')
assert.match(poFileRoute, /getPurchaseRequestPoFileUrl/, 'the PO preview route reuses the permission-checked server action')
assert.match(poFileRoute, /export async function GET/, 'the PO preview route serves the compact summary action')

const editPage = read('app/(protected)/purchase-requests/[id]/edit/page.tsx')
assert.match(editPage, /params:\s*Promise</)
assert.match(editPage, /request\.status !== 'pending'/, 'the edit route must refuse confirmed or cancelled PRs')
assert.match(editPage, /canManagePurchaseRequest\(actor, request\.requesterId\)/)
assert.match(editPage, /purchaseMethodSchema\.safeParse/, 'stored method details must be validated before filling the form')
assert.match(editPage, /initialValues/)
assert.match(editPage, /mode="edit"/)

const form = read('components/pr/PurchaseRequestForm.tsx')
assert.match(form, /^['"]use client['"]/m)
assert.match(form, /createPurchaseRequest/)
assert.match(form, /updatePurchaseRequest/)
assert.match(form, /initialValues/)
assert.match(form, /mode === 'edit'/)
assert.doesNotMatch(form, /เจ้าหน้าที่คลังกดยืนยันแล้วสร้างสัญญาใหม่ทันที/, 'the new PR page must not show the contract-creation helper sentence')
assert.match(form, /PurchaseMethodFields/)
assert.match(form, /ContractItemPicker/)
assert.match(form, /requestedQuantity: number \| ''/, 'PR quantity state must allow an empty value while editing')
assert.match(form, /unitPrice: number \| ''/, 'PR unit-price state must allow an empty value while editing')
assert.match(form, /value === '' \? '' : Number\(value\)/, 'clearing a PR numeric field must remain blank instead of becoming zero')
assert.match(form, /requestedQuantity: option\.contractItemId !== null \? '' : 1/, 'contract quantities must start blank while other methods retain their default')
assert.match(form, /required=\{!isContractPurchase\}/, 'a blank contract quantity must pass native form validation')
assert.match(form, /quantityIsBlankOrZero/, 'blank and zero contract quantities must be treated as zero')
assert.match(form, /\.filter\(\(line\) => isFiniteDraftNumber\(line\.requestedQuantity\) && line\.requestedQuantity > 0\)/, 'zero contract lines must be omitted from the submitted PR')
assert.match(form, /departments: readonly string\[\]/)
assert.match(form, /<select required value=\{department\}/)
assert.match(form, /\{departments\.map\(\(department\)/)
assert.doesNotMatch(form, /<input type="text" required value=\{department\}/)
assert.match(form, /ชื่อผู้ขอ/, 'the requester header labels the person as ชื่อผู้ขอ')
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
  /method !== null && method\.kind !== 'contract' && !isLease && \([\s\S]*?SELECT ITEMS/,
  'the item picker must hide once a contract auto-fills the request lines, and for a lease which has no reagent lines at all',
)
assert.match(
  form,
  /method\?\.kind === 'contract'\s*\?\s*'กรุณาเลือกสัญญาก่อน/,
  'the empty request-lines state must point at picking a contract, since the item picker is no longer visible to explain itself',
)
assert.match(form, /จุดประสงค์และวิธีจัดซื้อ/)
assert.match(form, /isOverContractLimit/, 'requesting more than a contract line has left must be caught before submit')
assert.match(form, /isLowContractBalance/, 'a line under 30% remaining must be flagged, matching the dashboard watchlist threshold')
assert.match(
  form,
  /disabled=\{isPending \|\| \(!isLease && !hasPositiveRequestedQuantity\) \|\| methodSelectionMissing \|\| hasInvalidLine \|\| hasOverLimitLine \|\| !checklistComplete\}/,
  'submit must stay blocked until a non-lease PR has at least one positive quantity, while a complete lease with zero lines remains submittable',
)
const purchaseMethodFields = read('components/pr/PurchaseMethodFields.tsx')
assert.match(purchaseMethodFields, /contract-purchase-note/, 'contract purchase guidance must appear beneath the selected contract')
assert.match(form, /const isLease = method\?\.kind === 'equipment_lease'/, 'a lease originates a contract with zero line items')
assert.match(form, /คงเหลือในสัญญา/, 'the request-lines table must show each line\'s remaining contract balance')
assert.match(form, /changeDepartment/, 'changing the requesting department must re-filter its contract lists')
assert.match(form, /changePurpose/)
assert.match(form, /methodRequiresAnnualPlanReference/, 'every checklist method with a plan-page requirement must use the generated plan reference flow')
assert.match(form, /generateAnnualPlanEvidence/, 'the plan-page attachment is generated from the stored plan, not uploaded again by the requester')
assert.match(form, /hiringPlan/, 'equipment leases must receive the current hiring plan as a separate source')
assert.match(form, /matchAnnualPlanContractName/, 'equipment leases must match their plan row from contract name only')
assert.match(form, /isPurchaseRequestActionError\(saved\)/, 'PR submission errors must return to the form instead of rendering a production Server Components error')

const planReferenceFields = read('components/pr/AnnualPlanReferenceFields.tsx')
assert.match(planReferenceFields, /PROCUREMENT PLAN MATCHING/)
assert.match(planReferenceFields, /ไม่ต้องแนบไฟล์แผนซ้ำ/, 'the plan reference panel must explain that the requester does not re-upload the annual plan')

const checklistFields = read('components/pr/PurchaseRequestChecklistFields.tsx')
assert.match(checklistFields, /methodRequiresAnnualPlanReference/, 'the generated plan evidence must replace the plan upload dropzone')
assert.match(checklistFields, /ไฟล์นี้สร้างและแนบเข้าใบ PR โดยระบบเมื่อกดส่ง/, 'the checklist must tell the requester when the generated plan file is attached')
assert.match(checklistFields, /พร้อมสร้าง/, 'the generated plan card must distinguish ready-to-generate from already-uploaded files')
assert.match(detailPage, /methodRequiresAnnualPlanReference/, 'saved references must be loaded for every plan-backed PR method')
assert.match(editPage, /methodRequiresAnnualPlanReference/, 'editing a plan-backed PR must load its saved reference')
assert.match(detailPage, /planType === 'hiring'/, 'saved hiring-plan references must render separately from procurement lines')

const checklistQueries = read('lib/pr/checklist-queries.ts')
assert.match(checklistQueries, /purchase_request_items/, 'saved plan references must use PR line order when reopening an edit form')
assert.match(checklistQueries, /orderedLineRows/, 'plan references must not rely on UUID order')

assert.match(
  form,
  /useState<PurchasePurpose \| null>\(initialValues\?\.purpose \?\? null\)/,
  'a new request must not arrive with a purpose already chosen',
)
assert.match(
  form,
  /useState<PurchaseMethod \| null>\(\(\) => initialValues\?\.method \?\? null\)/,
  'a new request must not arrive with a purchase method already chosen',
)
assert.doesNotMatch(
  form,
  /\?\? \{ kind: 'off_plan' \}/,
  'ซื้อนอกแผน is the exceptional method and must never be the silent default',
)
assert.match(
  form,
  /methodSelectionMissing =\s*method === null \|\|/,
  'submit stays blocked until a method is actually picked',
)
assert.match(
  form,
  /if \(method === null\) \{[\s\S]{0,160}return/,
  'submitting by keyboard without a method must be refused, not sent as null',
)

// Changing purpose used to jump to the first method of the new group, which
// re-introduced the same silent pick one level up.
assert.match(
  form,
  /setPurpose\(nextPurpose\)[\s\S]{0,240}setMethod\(null\)/,
  'switching purpose must clear the method rather than auto-pick the first one',
)

assert.match(form, /aria-live="polite"/, 'clearing picked lines on a method/department change must be announced')
assert.match(form, /methodSelectionMissing/, 'the form must know when there is nothing to select and disable submit')

const styles = read('app/globals.css')
assert.match(styles, /\.pr-review__section\s*\{[^}]*border-top:\s*2px solid/, 'review sections need a visible divider')
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
  /\.data-table (?:input|:is\(td, th\) > input)\s*\{[\s\S]*?border:\s*1px solid var\(--lab-border-strong\);[\s\S]*?\}/,
  'quantity/price inputs inside a data-table must render a visible border, not rely on the bare browser default',
)
assert.match(
  styles,
  /\.data-table td\.pr-line-cell--name\.pr-line-cell--manual > input\s*\{[\s\S]*?width:\s*100%/,
  'a manually added reagent name must use the full name column instead of inheriting the narrow numeric input width',
)
assert.match(styles, /\.pr-review__identifier-field\s*\{[^}]*width:\s*min\(100%, 520px\)/, 'PR and PO identifiers should not stretch across the full review card')
assert.match(styles, /\.pr-review__identifier-field input:read-only\s*\{[^}]*background:\s*color-mix/, 'saved PR and PO identifiers should have a muted filled-state background')
assert.match(styles, /\.pr-review__number-action\s*\{[^}]*min-width:\s*220px/, 'identifier actions should size to their label instead of stretching')
assert.match(styles, /\.pr-review__po-file:only-child\s*\{[^}]*grid-column:\s*2/, 'a PO file without an editable number field should stay in the right workbench column')
assert.match(styles, /@media \(max-width: 800px\) \{[\s\S]*?\.pr-review__po-file:only-child\s*\{[^}]*grid-column:\s*auto/, 'the standalone PO file should return to the mobile flow')

assert.match(styles, /\.pr-register-table\s*\{[\s\S]*?table-layout:\s*fixed/, 'PR register columns must stay aligned even when row content widths differ')
assert.match(styles, /\.pr-register-table__status\s*\{[^}]*width:\s*13%/, 'the PR status column needs a stable width for different chip labels')
assert.match(styles, /\.pr-register-table__receiving\s*\{[^}]*width:/, 'the PR register must reserve a stable receiving-summary column')

const methodFields = read('components/pr/PurchaseMethodFields.tsx')
assert.match(methodFields, /PURCHASE_METHOD_LABELS/, 'the six methods come from the shared presenter')
assert.match(methodFields, /PURCHASE_PURPOSE_LABELS/, 'the purpose fork has its own labels')
assert.doesNotMatch(methodFields, /เจ้าหน้าที่คลังกดยืนยันแล้วสร้างสัญญาใหม่ทันที/, 'the new PR page must not show the contract-creation consequence sentence')
// Without a purpose there is no method list to show, so the panel has to say
// what to do instead of rendering an empty radio group.
assert.match(
  methodFields,
  /purpose === null && \([\s\S]{0,200}เลือกจุดประสงค์ด้านบนก่อน/,
  'an unchosen purpose must explain itself rather than show nothing',
)
assert.match(methodFields, /purpose === null \? \[\] : PURCHASE_METHODS_BY_PURPOSE\[purpose\]/, 'only the current purpose\'s methods are offered')
assert.match(methodFields, /annualPlanFiscalYear/)
assert.doesNotMatch(methodFields, /ลำดับในแผนจัดซื้อ[\s\S]*field-required/, 'annual-plan sequence must not be a requester-entered required field')
assert.match(methodFields, /purchaseSequence/)
assert.match(methodFields, /readOnly/)
assert.match(methodFields, /contractId: 0,[\s\S]*?purchaseSequence: 1/, 'a contract method must start unselected — auto-picking contracts[0] would silently auto-fill the wrong contract')
assert.match(methodFields, /<option value=\{0\} disabled>เลือกสัญญา<\/option>/, 'the contract dropdown must show an explicit placeholder, not silently pre-pick one')
assert.match(methodFields, /awaitingContracts/)
assert.match(methodFields, /method\.kind === 'e_bidding'/)
// The lease ceiling moved to the stage-advance step. Leaving the field here
// would collect a pre-negotiation estimate that the schema now refuses.
assert.doesNotMatch(
  methodFields,
  /มูลค่าสัญญา/,
  'a lease PR must not ask for a ceiling — it is settled at contract_started',
)
assert.doesNotMatch(
  methodFields,
  /total:/,
  'no ceiling belongs in the contract draft any more, not even as a default',
)
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
assert.match(review, /PurchaseRequestPoFileCard/, 'PO file controls belong in the stock officer panel')
assert.match(review, /variant="inline"/, 'the PO file controls use the inline treatment beside PO controls')
assert.match(review, /request\.poFile/, 'the stock officer panel passes the PR PO file audit record to the card')
assert.match(review, /pr-review__po-workbench/, 'the PO number and PO document controls share one officer workbench')
assert.match(review, /pr-review__po-file/, 'the PO file controls sit beside the officer PO controls')
assert.doesNotMatch(review, /showOpenAction/, 'the STOCK OFFICER PO document controls keep their existing placement and actions')
assert.match(
  review,
  /\['completed', 'partially_received'\]\.includes\(request\.status\)/,
  'a partially received PR must still expose the PO number field so its PR-owned PO record can be completed',
)
assert.match(
  review,
  /const canEditPoNumber = !contractType && \['completed', 'partially_received'\]\.includes\(request\.status\)/,
  'only open purchase-order PR states can edit the PO number',
)
assert.match(
  review,
  /canEditPoNumber\s*\?\s*\([\s\S]*?เลขที่ใบสั่งซื้อ \(PO\)\s*<input/,
  'a contract-originating PR opens a contract directly and never becomes a purchase order, so it must not show a PO number field',
)
assert.match(review, /formatThaiDateTime/, 'audit lines must show a full date and time, not just a date')
assert.match(review, /ยืนยันโดย.*acknowledgedByName/, 'a completed or reversed PR must name who confirmed it')
assert.match(review, /ยกเลิกโดย.*reversedByName/, 'a reversed PR must name who cancelled it, distinct from who confirmed it')
assert.match(review, /บันทึกเลขที่ใบสั่งซื้อ \(PO\) โดย.*updatedByName/, 'recording a PO number must be attributed too')
assert.match(review, /pr-review__meta/, 'audit lines live inside the officer action panel, not the requester-facing method detail')
assert.match(review, /const \[isEditingPoNumber, setIsEditingPoNumber\] = useState\(!request\.poNumber\)/, 'a saved PO number starts locked')
assert.match(review, /readOnly=\{!isEditingPoNumber\}/, 'a saved PO number must be read-only until edit is requested')
assert.match(review, /if \(!isEditingPoNumber\) \{[\s\S]*?setIsEditingPoNumber\(true\)/, 'the PO action must unlock the field before editing')
assert.match(review, /setIsEditingPoNumber\(false\)/, 'saving an edited PO number must lock the field again')
assert.match(review, /แก้ไขเลขที่ใบสั่งซื้อ/, 'the locked PO action must offer an explicit edit label')
assert.match(review, /pr-review__identifier-field/, 'PR and PO identifiers use the compact field treatment')
assert.match(review, /pr-review__number-action/, 'identifier actions use the compact button treatment')
assert.match(review, /hasDraftReceipt/, 'an open receipt draft must block PR reversal in the UI')
assert.match(review, /hasPostedReceipt/, 'posted receiving history must block PR reversal in the UI')
assert.match(review, /!receiptBlocksReversal/, 'the reversal action must be hidden while receipt history blocks it')

const presenter = read('lib/pr/presenter.ts')
assert.match(presenter, /ซื้อในแผนทั้งปี/)
assert.match(presenter, /ซื้อในสัญญา/)
assert.match(presenter, /นอกแผน/)
assert.match(presenter, /ซื้อเจาะจงระหว่างรอสัญญา/)
assert.match(presenter, /ทำสัญญาเจาะจง/)
assert.match(presenter, /เช่าเครื่อง/, 'a lease PR method needs its own label')
assert.match(presenter, /PURCHASE_PURPOSE_LABELS/, 'the purpose fork needs its own labels, distinct from the method labels')
assert.match(presenter, /partially_received:\s*'รับบางส่วน'/, 'partial receiving needs a Thai PR status label')
assert.match(presenter, /received:\s*'รับครบ'/, 'fully received needs a Thai PR status label')
assert.match(presenter, /cancelled:\s*'ยกเลิก'/, 'pre-confirmation cancellation needs the shared Thai status label')
assert.match(presenter, /reversed:\s*'ยกเลิก'/, 'post-confirmation cancellation needs the shared Thai status label')
assert.match(presenter, /ทำใบ PR เพื่อสั่งซื้อ/)
assert.match(presenter, /ทำใบ PR เพื่อเริ่มสัญญาใหม่/)
assert.match(presenter, /ต่ำกว่าขั้นต่ำ|ควรทำ PR/, 'minimum-stock warning wording lives with the labels')

const actions = read('lib/pr/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /actionRequestId/, 'PR mutations need a correlation id in server diagnostics')
assert.match(actions, /Purchase request RPC mutation failed/, 'Supabase mutation errors must retain code/details/hint in server logs')
assert.match(actions, /purchaseRequestActionError/, 'expected PR validation failures must be returned as action errors')
assert.match(actions, /supabaseAdmin\.rpc\('create_purchase_request_with_checklist'/)
assert.match(actions, /supabaseAdmin\.rpc\('update_purchase_request'/)
assert.match(actions, /supabaseAdmin\.rpc\('cancel_purchase_request'/)
assert.match(actions, /supabaseAdmin\.rpc\('confirm_purchase_request_with_committees'/)
assert.match(actions, /p_sent_to_procurement_date/, 'confirming a contract-opening PR must carry its ส่งพัสดุ date')
assert.match(actions, /supabaseAdmin\.rpc\('reverse_purchase_request'/)
assert.match(actions, /supabaseAdmin\.rpc\('set_purchase_order_number'/)
assert.match(actions, /assertPurchaseRequester/)
assert.match(actions, /assertPurchaseRequestManager/)
assert.match(actions, /getPurchaseRequest/)
assert.match(actions, /assertStockOperator/)

const queries = read('lib/pr/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /createClient/)
assert.match(queries, /po_file_path/, 'PR reads must own the PO file path and audit metadata')
assert.match(queries, /po_file_uploaded_by|po_uploader/, 'PR reads must include the uploader audit relation')
assert.match(queries, /po_file_deleted_by|po_deleter/, 'PR reads must include the deletion audit relation')
assert.match(queries, /department\?: string/, 'purchase-request queries accept a department filter')
assert.match(queries, /filters\.department/, 'purchase-request queries apply the department filter')
assert.match(queries, /purchaseMethod\?: PurchaseMethodKind/, 'purchase-request queries accept a purchase-method filter')
assert.match(queries, /filters\.purchaseMethod/, 'purchase-request queries apply the purchase-method filter')
assert.match(queries, /filters\.status === 'cancelled'[\s\S]*?\.in\('status', \['cancelled', 'reversed'\]\)/, 'the cancelled filter must include both cancellation lifecycle states')
assert.match(queries, /listNextContractPurchaseSequences/)
assert.match(queries, /created_contract_id/, 'a confirmed PR must link forward to the contract it opened')
assert.match(queries, /goods_receipt_items \([\s\S]*?lot_number[\s\S]*?expiry_date[\s\S]*?quantity/, 'PR receipt history must load receipt line details')
assert.match(queries, /mapReceiptHistoryItem/, 'receipt line details must be mapped into the PR domain record')
assert.doesNotMatch(queries, /supabaseAdmin/, 'PR reads stay under RLS')
assert.match(
  queries,
  /requesterName: row\.requester\?\.name\?\.trim\(\) \|\| row\.head_name\.trim\(\) \|\| null/,
  'the requester display must fall back to the PR name snapshot when profile RLS hides the relation',
)

const prTypes = read('lib/pr/types.ts')
assert.match(prTypes, /PurchaseRequestPoFileRecord/)
assert.match(prTypes, /poFile:/)

const table = read('components/pr/PurchaseRequestTable.tsx')
assert.match(table, /className="data-table pr-register-table"/, 'the PR register must use its fixed column layout')
assert.match(table, /<colgroup>[\s\S]*?pr-register-table__document[\s\S]*?pr-register-table__action[\s\S]*?<\/colgroup>/, 'the desktop PR register must define one shared width for every column')
assert.match(table, /<PurchaseRequestSummaryDialog\s+request=\{request\}[\s\S]{0,500}?\/>/, 'the desktop row must open the mini summary popup, not a plain cell')
assert.match(table, /<PurchaseRequestSummaryDialog\s+request=\{request\}[\s\S]{0,250}?variant="card"[\s\S]{0,500}?\/>/, 'the mobile card must open the same popup')
assert.match(table, /DetailIconLink/, 'the trailing detail action must use the shared icon link')
assert.doesNotMatch(table, /<Link[^>]*>\s*ดูรายละเอียด/, 'the trailing detail action must not render a visible text label')

const formLayout = read('components/pr/PurchaseRequestForm.tsx')
assert.match(formLayout, /pr-form-lines-table--desktop/, 'the wide PR line table must have an explicit desktop-only presentation')
assert.match(formLayout, /className="pr-form-line-cards"/, 'the PR form must provide phone-friendly line cards')
assert.match(formLayout, /pr-form-line-card__fields/, 'phone PR cards must keep editable line fields')

const summaryDialog = read('components/pr/PurchaseRequestSummaryDialog.tsx')
assert.match(summaryDialog, /^['"]use client['"]/m)
assert.match(summaryDialog, /<dialog\b/, 'must use the native dialog element')
// Deferred rather than always mounted: the register renders one of these per
// row and renders every row twice, for the table and the card layout. Always
// building the body put 393 dialogs and 2.5MB of HTML on the inventory list
// alone. The native modal contract is unchanged, and lives in the shared hook.
assert.match(summaryDialog, /useDeferredDialog\(\)/, 'the trigger must open it through the shared deferred-dialog hook')
assert.match(summaryDialog, /\{isRendered && \(/, 'the dialog body must stay behind the isRendered gate')
const deferredDialog = read('components/ui/useDeferredDialog.ts')
assert.match(deferredDialog, /showModal\(\)/, 'the shared hook must still open a native modal dialog')
assert.match(deferredDialog, /setIsRendered\(false\)/, 'a summary close must be able to unmount the native dialog and release the top layer')
assert.match(summaryDialog, /unmountDialog/, 'the PR summary must use the hard-close path so it cannot leave a stale modal mounted')
assert.match(summaryDialog, /list-summary-dialog/)
assert.match(summaryDialog, /PurchaseRequestPoFileOpenButton/, 'the compact PR summary exposes the PO open action')
assert.match(summaryDialog, /request\.poFile\.path && !request\.poFile\.deletedAt/, 'the compact PR summary only exposes active attached PO files')
assert.match(summaryDialog, /list-summary-dialog__po-value/, 'the compact summary keeps the PO action with the PO number')
assert.match(
  styles,
  /\.list-summary-dialog\[open\]\s*\{[\s\S]*?display:\s*grid/,
  'the list summary layout must only override display while the native dialog is open',
)
for (const [path, label] of [
  ['components/receipts/GoodsReceiptSummaryDialog.tsx', 'receipt summary'],
  ['components/requisitions/RequisitionSummaryDialog.tsx', 'requisition summary'],
  ['components/contracts/ContractSummaryDialog.tsx', 'contract summary'],
] as const) {
  assert.match(read(path), /unmount: unmountDialog/, `${label} must use the immediate hard-close path`)
}
assert.match(summaryDialog, /StatusChip tone=\{PURCHASE_REQUEST_STATUS_TONES/, 'status must never be a bare colored word')
assert.match(summaryDialog, /createdContractId/, 'a PR that opened a contract must link to it from the popup')
assert.match(summaryDialog, /DetailIconLink/, 'the popup detail route must use the shared icon link')
assert.match(summaryDialog, /รายการน้ำยา/, 'the PR popup must show its reagent section')
assert.match(summaryDialog, /request\.items\.map/, 'the PR popup must list every reagent line')
assert.match(summaryDialog, /formatQuantity\(item\.remainingQuantity, item\.unit\)/, 'the PR popup must foreground each remaining quantity')
assert.match(summaryDialog, /formatQuantity\(item\.requestedQuantity, item\.unit\)/, 'the PR popup must retain the original requested quantity for context')

const detailIconLink = read('components/ui/DetailIconLink.tsx')
assert.match(detailIconLink, /DocumentOpenIcon/, 'detail links must use the document icon')
assert.match(detailIconLink, /icon = 'document'/, 'the document icon must be the shared default for detail links')
assert.match(detailIconLink, /icon === 'document' \? <DocumentOpenIcon \/>/, 'the shared detail link must render the document icon')
assert.doesNotMatch(detailIconLink, /OpenDetailIcon|icon === 'open'/, 'detail links must not retain the arrow-icon variant')
for (const path of [
  'components/pr/PurchaseRequestSummaryDialog.tsx',
  'components/requisitions/RequisitionSummaryDialog.tsx',
  'components/receipts/GoodsReceiptSummaryDialog.tsx',
] as const) {
  assert.doesNotMatch(read(path), /icon="open"/, `${path} must not override the document detail icon`)
}

const lifecycleControls = read('components/pr/PurchaseRequestLifecycleControls.tsx')
assert.match(lifecycleControls, /cancelPurchaseRequest/)
assert.match(lifecycleControls, /hardDeletePurchaseRequest/)
assert.match(lifecycleControls, /canHardDelete/)
assert.match(lifecycleControls, /ลบถาวร/)
assert.match(lifecycleControls, /ยืนยันการลบถาวร/)
assert.match(lifecycleControls, /ยืนยันการยกเลิก PR/)
assert.match(lifecycleControls, /เก็บประวัติไว้/, 'deleting a PR keeps an audit trail')
assert.match(lifecycleControls, /router\.push\('\/purchase-requests'\)/)

const shortClose = read('components/pr/PurchaseRequestRemainingClosePanel.tsx')
assert.match(shortClose, /closePurchaseRequestRemaining/, 'short close must use a server-side audited action')
assert.match(shortClose, /hasDraftReceipt/, 'an open draft must block short close until it is cancelled')
assert.match(shortClose, /closedShortByName|closedShortAt|closedShortReason/, 'short close must render actor, time, and reason audit fields')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/purchase-requests/)

console.log('purchase request UI: ok')
