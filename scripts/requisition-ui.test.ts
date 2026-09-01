import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getRequisitionItemDepartments } from '../lib/organization/departments'

const read = (path: string) => readFileSync(path, 'utf8')

const newPage = read('app/(protected)/requisitions/new/page.tsx')
const listPage = read('app/(protected)/requisitions/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</, 'the requisition list reads URL filters on the server')
assert.match(listPage, /หน่วยงาน/, 'requesters can filter requisitions by department')
assert.match(listPage, /AutoFilterBench/, 'requisition filters must update the list immediately')
assert.doesNotMatch(listPage, /แสดงผล/, 'requisition filters must not require an apply button')
assert.match(listPage, /RequisitionSummaryDialog requisition=\{requisition\}/, 'the list row must open the mini summary popup, not a plain document-number cell')
assert.match(listPage, /receiptAction=/, 'receivable requisitions must expose the receipt action in the mini summary popup')
assert.match(listPage, /DetailIconLink/, 'the requisition detail action must use the shared icon link')
assert.match(listPage, /REQUISITION_STATUS_LABELS|REQUISITION_STATUS_TONES/, 'the list page must use the shared requisitions presenter, not a local status map')
assert.match(listPage, /showCancelled/, 'cancelled requisitions must have an explicit visibility toggle')
assert.match(listPage, /แสดงใบยกเลิก|ซ่อนใบยกเลิก/)
assert.match(listPage, /showReceived/, 'received requisitions must have an explicit visibility toggle')
assert.match(listPage, /requisition\.status !== 'received'/, 'received requisitions must be hidden from the default register')
assert.match(listPage, /แสดง(?:ใบ|รายการ)ตรวจรับแล้ว/, 'the register must provide a button to show received requisitions')
assert.match(listPage, /ซ่อน(?:ใบ|รายการ)ตรวจรับแล้ว/, 'the received visibility button must be reversible')
assert.match(listPage, /className="data-table requisition-register-table"/, 'the requisition register must use its deliberate column layout')
assert.match(listPage, /<colgroup>[\s\S]*requisition-register-table__document[\s\S]*requisition-register-table__action/, 'the register must declare stable column widths')
assert.match(listPage, /requisition-register-table__cell--center requisition-register-table__items-cell/, 'the item count column must be centered')
assert.match(listPage, /<th className="requisition-register-table__cell--center">สถานะ<\/th>/, 'the status header must be centered')
assert.match(listPage, /requisition-register-table__cell--center requisition-register-table__status-cell/, 'the status value must be centered')
const globalStyles = read('app/globals.css')
assert.match(globalStyles, /\.requisition-register-table\s*\{[\s\S]*table-layout:\s*fixed/, 'the register must keep columns stable while requester text varies')
assert.match(globalStyles, /\.requisition-register-table__requester-cell\s*\{[\s\S]*overflow-wrap:\s*anywhere/, 'long requester details must not force the table wider')
assert.match(globalStyles, /\.requisition-short-issue-reason\s*\{[\s\S]*text-align:\s*center/, 'partial-payment reasons must be centered within the detail row')

const requisitionPresenter = read('lib/requisitions/presenter.ts')
assert.match(requisitionPresenter, /REQUISITION_STATUS_LABELS/)
assert.match(requisitionPresenter, /REQUISITION_STATUS_TONES/)

const summaryDialog = read('components/requisitions/RequisitionSummaryDialog.tsx')
assert.match(summaryDialog, /^['"]use client['"]/m)
assert.match(summaryDialog, /<dialog\b/, 'must use the native dialog element')
// Deferred rather than always mounted: the register renders one of these per
// row and renders every row twice, for the table and the card layout. Always
// building the body put 393 dialogs and 2.5MB of HTML on the inventory list
// alone. The native modal contract is unchanged, and lives in the shared hook.
assert.match(summaryDialog, /useDeferredDialog\(\)/, 'the trigger must open it through the shared deferred-dialog hook')
assert.match(summaryDialog, /\{isRendered && \(/, 'the dialog body must stay behind the isRendered gate')
assert.match(read('components/ui/useDeferredDialog.ts'), /showModal\(\)/, 'the shared hook must still open a native modal dialog')
assert.match(summaryDialog, /list-summary-dialog/)
assert.match(summaryDialog, /StatusChip tone=\{REQUISITION_STATUS_TONES/, 'status must never be a bare colored word')
assert.match(summaryDialog, /DetailIconLink/, 'the requisition popup detail route must use the shared icon link')
assert.match(summaryDialog, /RequisitionReceiptDialog/, 'the requisition popup must expose the receipt workflow when the actor can receive it')
assert.match(summaryDialog, /triggerClassName="list-summary-dialog__receipt-trigger"/, 'the receipt action must occupy the left side of the popup footer')
assert.doesNotMatch(summaryDialog, /toDataURL|<img/, 'the popup must not render the signature image — keep it light, the full image lives on the detail page')
assert.match(summaryDialog, /รายการน้ำยา/, 'the requisition popup must show its reagent section')
assert.match(summaryDialog, /requisition\.items\.map/, 'the requisition popup must list every requested reagent')
assert.match(summaryDialog, /formatQuantity\(item\.requestedQuantity, item\.unit\)/, 'the requisition popup must show each requested quantity')
assert.doesNotMatch(summaryDialog, /totalRequested|รวมที่ขอ/, 'the requisition popup must not show a mixed-unit sum')
assert.match(newPage, /RequisitionForm/)
assert.match(newPage, /DEPARTMENTS/)
assert.match(newPage, /requesterDepartment=\{requesterDepartment\}/)
assert.match(newPage, /actor\.department/)
assert.match(newPage, /note: item\.note/, 'the requisition catalog must carry each inventory note')

const form = read('components/requisitions/RequisitionForm.tsx')
assert.match(form, /departments: readonly string\[\]/)
assert.match(form, /requesterDepartment\?: string \| null/)
assert.doesNotMatch(form, /departmentIsAutoSelected|disabled=\{departmentIsAutoSelected\}/, 'the auto-selected department must remain editable')
assert.match(form, /<select[\s\S]*required[\s\S]*value=\{department\}/)
assert.match(form, /\{departments\.map\(\(department\)/)
assert.doesNotMatch(form, /<input type="text" required value=\{department\}/)
assert.match(form, /CatalogItemCombobox/, 'requisition items must be searchable by typing')
assert.match(form, /note: string \| null/, 'requisition catalog items must include the inventory note')
assert.match(form, /note: item\.note \?\? ''/, 'a new requisition line must start with the inventory note')
assert.match(form, /className="requisition-line__readonly-note"/, 'the line note must use the read-only style')
assert.match(form, /readOnly/, 'the inventory note field must not be editable')
const catalogCombobox = read('components/ui/CatalogItemCombobox.tsx')
assert.match(catalogCombobox, /พิมพ์รหัสพัสดุ หรือชื่อรายการ/, 'requisition item search must provide a hint')

// The browsable dropdown offers the requester's work unit plus the four shared
// operational units. The type-ahead search deliberately has a wider scope.

// Items with no currently available quantity never reach the picker. Physical
// on-hand can exist while another waiting requisition has already reserved it.
assert.match(
  form,
  /availableCatalog = catalog\.filter\(\(item\) => item\.availableToRequest > 0\)/,
  'the picker must only offer items with available-to-request stock',
)

assert.match(
  form,
  /eligibleDepartments = getRequisitionItemDepartments\(department\)/,
  'the item picker must calculate the requester eligible departments',
)
assert.match(
  form,
  /item\.responsibleDepartment !== null && eligibleDepartments\.includes\(item\.responsibleDepartment\)/,
  'the dropdown must include only assigned items in eligible departments',
)
assert.match(form, /selectableDepartmentCatalog\.map/, 'the dropdown options must come from the department-filtered catalog')
assert.match(form, /searchableCatalog = availableCatalog\.filter/, 'the type-ahead search must use the full available catalog')
assert.match(form, /ขณะนี้ไม่มีรายการน้ำยาที่เบิกได้ในขอบเขตหน่วยงานของ dropdown/)
assert.match(form, /selectedItemIds = new Set\(lines\.map\(\(line\) => line\.inventoryItemId\)\)/, 'selected reagents must be removed from both picker controls')
assert.match(form, /selectableDepartmentCatalog = departmentCatalog\.filter\(\(item\) => !selectedItemIds\.has\(item\.inventoryItemId\)\)/, 'the dropdown must use the unselected department catalog')
assert.match(form, /disabled=\{selectableDepartmentCatalog\.length === 0\}/, 'the dropdown must be disabled when there is no remaining scoped choice')
assert.match(form, /disabled=\{searchableCatalog\.length === 0\}/, 'the type-ahead must be disabled when the full available catalog is exhausted')
assert.match(form, /Active ที่ยังเบิกได้ทุกหน่วยงาน/, 'the type-ahead scope must be explained to the requester')
assert.match(form, /เลือกรายการน้ำยาที่เบิกได้ในหน่วยงานนี้ครบแล้ว/, 'the dropdown must distinguish all-scoped-selected from no-stock states')

// The requester picks straight from the dropdown, so the option itself must
// carry the total on hand. Lot detail belongs to the officer choosing FIFO
// lots at fulfillment, not to the person asking for a quantity.
assert.match(
  form,
  /\{item\.lsCode\} · \{item\.name\} · เบิกได้อีก \{formatQuantity\(item\.availableToRequest, item\.unit\)\}/,
  'the dropdown option must show the available-to-request quantity',
)
assert.match(form, /availableToRequest: number/, 'form lines must carry reservation-aware availability')
assert.match(form, /requestedQuantity: number \| ''/, 'quantity input state must allow an empty value while editing')
assert.match(form, /value === '' \? '' : Number\(value\)/, 'clearing the quantity input must remain blank instead of becoming zero')
assert.match(form, /max=\{line\.availableToRequest\}/, 'quantity input must cap at available-to-request stock')
assert.match(form, /quantity > line\.availableToRequest/, 'the form must block stale over-requests')
assert.match(form, /disabled=\{isPending \|\| lines\.length === 0 \|\| hasAvailabilityError\}/)
assert.match(form, /เบิกได้อีก/, 'the line must explain the reservation-aware quantity')
assert.doesNotMatch(form, /showingUnfilteredCatalog|scopedCatalog/, 'the picker must not fall back to unrelated inventory')

assert.deepEqual(
  getRequisitionItemDepartments('งานอณูชีววิทยา'),
  ['งานอณูชีววิทยา', 'สำนักงานกลุ่มงานเทคนิคการแพทย์', 'คลังน้ำยาและวัสดุวิทยาศาสตร์', 'POCT', 'งานบริการผู้ป่วยนอก'],
  'the requisition dropdown must include the requester work unit and four shared stock units',
)

// A real <select> lets the requester browse every eligible item at once,
// alongside the type-ahead combobox for a faster path when they know the code.
assert.match(form, /<select[\s\S]{0,120}onChange=\{\(event\) => \{[\s\S]{0,220}selectableDepartmentCatalog\.find/, 'a browsable dropdown must exist in addition to the search combobox')
assert.match(form, /CatalogItemCombobox/, 'the search combobox must remain available as an alternative')
assert.match(catalogCombobox, /disabled\?: boolean/, 'the type-ahead picker must support a disabled exhausted state')

const queries = read('lib/requisitions/queries.ts')
assert.match(queries, /department\?: string/, 'requisition queries accept a department filter')
assert.match(queries, /filters\.department/, 'requisition queries apply the department filter')
assert.match(queries, /inventory_item_requisition_availability/, 'requisition catalog reads reservation-aware availability')
assert.match(queries, /fulfilled_by_name/, 'requisition reads use the fulfiller name snapshot')
assert.doesNotMatch(queries, /fulfiller:profiles!requisitions_fulfilled_by_fkey/, 'fulfiller names must not depend on profiles RLS')

// The detail page shows current on-hand stock per line, so the officer can
// judge fulfillment without switching to the inventory catalog.
const detailPage = read('app/(protected)/requisitions/[id]/page.tsx')
assert.match(detailPage, /listOnHand/, 'the detail page must read current on-hand stock for its lines')
assert.match(detailPage, /คงเหลือในคลัง/)
assert.match(detailPage, /รายการที่ต้องหยิบ|รายการที่จ่าย|รายการที่รอตรวจรับ|รายการที่ตรวจรับแล้ว/, 'the detail header must show a useful line-count workload, not mixed-unit totals')
assert.doesNotMatch(detailPage, /totalRequested|รวมที่ขอ/, 'the detail header must not show a mixed-unit sum')
assert.match(
  detailPage,
  /<th className="numeric-cell">ขอเบิก<\/th>[\s\S]*?<th className="numeric-cell">จ่ายจริง<\/th>[\s\S]*?<th className="numeric-cell" title="ยอดคงเหลือปัจจุบันของน้ำยา">คงเหลือในคลัง<\/th>/,
  'request detail columns must show requested, fulfilled, then on-hand quantity',
)
assert.match(detailPage, /item\.fulfilledQuantity === item\.requestedQuantity/, 'a fully paid line must be identifiable')
assert.match(detailPage, /✓ ครบแล้ว/, 'a fully paid line must show a completion cue')

assert.doesNotMatch(listPage, /รวมที่ขอ/, 'the requisition register must not show a mixed-unit sum')

const summaryDialogSource = read('components/requisitions/RequisitionSummaryDialog.tsx')
const detailFulfillerDisplay = "requisition.fulfilledByName ?? 'ไม่ระบุชื่อผู้จ่าย'"
assert.match(summaryDialogSource, new RegExp(detailFulfillerDisplay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.match(detailPage, new RegExp(detailFulfillerDisplay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.match(summaryDialogSource, /requisition\.status === 'fulfilled' \|\| requisition\.status === 'received'/, 'fulfilled and received requisitions must show the payout row')
assert.doesNotMatch(summaryDialogSource, /requisition\.status === 'fulfilled' && requisition\.fulfilledAt/, 'a missing timestamp must not hide the payout row')

const inventoryQueries = read('lib/inventory/queries.ts')
assert.match(inventoryQueries, /export async function listOnHand/)

// Receipt confirmation is available to every active LAB Stock user after
// fulfillment. The signature is read from Portal and a missing one falls back
// to the in-popup drawing flow.
assert.match(detailPage, /RequisitionReceiptDialog/)
assert.match(detailPage, /className="requisition-detail-actions"/, 'the receipt action must live in the detail page footer')
assert.match(detailPage, /canReceiveRequisition\(actor, requisition\.requesterId\) && requisition\.status === 'fulfilled'/)
assert.match(detailPage, /loadPortalSignatureDataUri/)
assert.match(detailPage, /requisition\.signedAt &&/, 'a read-only proof-of-receipt block must show once signed')
assert.match(detailPage, /หลักฐานการรับของ/)

const receiptDialog = read('components/requisitions/RequisitionReceiptDialog.tsx')
assert.match(receiptDialog, /^['"]use client['"]/m)
assert.match(receiptDialog, /<dialog\b/)
assert.match(receiptDialog, /useDeferredDialog/)
assert.match(receiptDialog, /createPortal/, 'the receipt dialog opened from a summary dialog must render in the document body')
assert.match(receiptDialog, /SignaturePad/)
assert.match(receiptDialog, /saveDrawnSignature/)
assert.match(receiptDialog, /receiveRequisition/)
assert.match(receiptDialog, /ขอเบิก/)
assert.match(receiptDialog, /จ่ายจริง/)
assert.match(receiptDialog, /\/staff\/profile/)
assert.doesNotMatch(receiptDialog, /type=["']file["']/i, 'the receipt popup must not offer a file input')

const signaturePad = read('components/requisitions/SignaturePad.tsx')
assert.match(signaturePad, /^['"]use client['"]/m)
assert.match(signaturePad, /onPointerDown/, 'drawing must work for mouse, touch, and pen alike via Pointer Events')
assert.match(signaturePad, /toDataURL\('image\/png'\)/)
assert.match(signaturePad, /ล้างลายเซ็นต์/, 'the signer must be able to clear and redraw')
assert.match(signaturePad, /hasSignatureRef/, 'canvas validation must not lose a fast first stroke')
assert.doesNotMatch(signaturePad, /createBrowserClient|supabase\.from/, 'the browser must never talk to Supabase directly')

const requisitionActions = read('lib/requisitions/actions.ts')
const actorSource = read('lib/auth/actor.ts')
assert.match(actorSource, /name,dept,avatar_url/, 'the signed-in actor must carry profiles.dept')
assert.match(requisitionActions, /assertCreateItemCatalog/, 'the server must validate selected items against the active catalog')
assert.match(requisitionActions, /item\.is_active/, 'the server must reject inactive inventory items')
assert.match(requisitionActions, /export async function saveDrawnSignature/)
assert.match(requisitionActions, /export async function receiveRequisition/)
assert.match(requisitionActions, /supabaseAdmin\.rpc\('receive_requisition'/)
assert.doesNotMatch(requisitionActions, /signRequisitionReceipt|sign_requisition_receipt/)
assert.match(requisitionActions, /assertStockOperator/)

console.log('requisition UI: ok')
