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
assert.match(listPage, /DetailIconLink/, 'the requisition detail action must use the shared icon link')
assert.match(listPage, /REQUISITION_STATUS_LABELS|REQUISITION_STATUS_TONES/, 'the list page must use the shared requisitions presenter, not a local status map')

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
assert.doesNotMatch(summaryDialog, /toDataURL|<img/, 'the popup must not render the signature image — keep it light, the full image lives on the detail page')
assert.match(summaryDialog, /รายการน้ำยา/, 'the requisition popup must show its reagent section')
assert.match(summaryDialog, /requisition\.items\.map/, 'the requisition popup must list every requested reagent')
assert.match(summaryDialog, /formatQuantity\(item\.requestedQuantity, item\.unit\)/, 'the requisition popup must show each requested quantity')
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

// The item picker only offers the requester's work unit plus the two shared
// stock units. Unassigned and unrelated items must stay out of the picker.

// Zero-on-hand items never reach the picker: the store cannot fill a line
// with no lot behind it, so offering one only produces a requisition that
// fails at fulfillment.
assert.match(
  form,
  /inStockCatalog = catalog\.filter\(\(item\) => item\.onHand > 0\)/,
  'the picker must only offer items that still have stock',
)

assert.match(
  form,
  /eligibleDepartments = getRequisitionItemDepartments\(department\)/,
  'the item picker must calculate the requester eligible departments',
)
assert.match(
  form,
  /item\.responsibleDepartment !== null && eligibleDepartments\.includes\(item\.responsibleDepartment\)/,
  'the item picker must include only assigned items in eligible departments',
)
assert.match(form, /departmentCatalog\.map/, 'the picker options must come from the department-filtered catalog')
assert.match(form, /ยังไม่มีรายการน้ำยาที่มีของคงเหลือในคลัง/)

// The requester picks straight from the dropdown, so the option itself must
// carry the total on hand. Lot detail belongs to the officer choosing FIFO
// lots at fulfillment, not to the person asking for a quantity.
assert.match(
  form,
  /\{item\.lsCode\} · \{item\.name\} · คงเหลือ \{formatQuantity\(item\.onHand, item\.unit\)\}/,
  'the dropdown option must show the total on-hand quantity',
)
assert.doesNotMatch(form, /showingUnfilteredCatalog|scopedCatalog/, 'the picker must not fall back to unrelated inventory')

assert.deepEqual(
  getRequisitionItemDepartments('งานอณูชีววิทยา'),
  ['งานอณูชีววิทยา', 'สำนักงานกลุ่มงานเทคนิคการแพทย์', 'คลังน้ำยาและวัสดุวิทยาศาสตร์'],
  'the requisition picker must include the requester work unit and both shared stock units',
)

// A real <select> lets the requester browse every eligible item at once,
// alongside the type-ahead combobox for a faster path when they know the code.
assert.match(form, /<select[\s\S]{0,120}onChange=\{\(event\) => \{[\s\S]{0,200}departmentCatalog\.find/, 'a browsable dropdown must exist in addition to the search combobox')
assert.match(form, /CatalogItemCombobox/, 'the search combobox must remain available as an alternative')

const queries = read('lib/requisitions/queries.ts')
assert.match(queries, /department\?: string/, 'requisition queries accept a department filter')
assert.match(queries, /filters\.department/, 'requisition queries apply the department filter')

// The detail page shows current on-hand stock per line, so the officer can
// judge fulfillment without switching to the inventory catalog.
const detailPage = read('app/(protected)/requisitions/[id]/page.tsx')
assert.match(detailPage, /listOnHand/, 'the detail page must read current on-hand stock for its lines')
assert.match(detailPage, /คงเหลือในคลัง/)

const inventoryQueries = read('lib/inventory/queries.ts')
assert.match(inventoryQueries, /export async function listOnHand/)

// The signature step appears right after fulfillment, only while unsigned,
// and a read-only proof-of-receipt block appears once it exists.
assert.match(detailPage, /RequisitionSignaturePanel/)
assert.match(
  detailPage,
  /canOperateStock\(actor\) && requisition\.status === 'fulfilled' && !requisition\.signedAt/,
  'the signature step must only show for a fulfilled, not-yet-signed requisition',
)
assert.match(detailPage, /requisition\.signedAt &&/, 'a read-only proof-of-receipt block must show once signed')
assert.match(detailPage, /หลักฐานการรับของ/)

const signaturePanel = read('components/requisitions/RequisitionSignaturePanel.tsx')
assert.match(signaturePanel, /^['"]use client['"]/m)
assert.match(signaturePanel, /signRequisitionReceipt/)
assert.match(signaturePanel, /SignaturePad/)
assert.match(signaturePanel, /defaultReceiverName/, 'the receiver name must default from the requester')
assert.match(
  signaturePanel,
  /disabled=\{isPending \|\| !receivedByName\.trim\(\) \|\| !signature\}/,
  'submit must stay blocked until both a name and a drawn signature exist',
)

const signaturePad = read('components/requisitions/SignaturePad.tsx')
assert.match(signaturePad, /^['"]use client['"]/m)
assert.match(signaturePad, /onPointerDown/, 'drawing must work for mouse, touch, and pen alike via Pointer Events')
assert.match(signaturePad, /toDataURL\('image\/png'\)/)
assert.match(signaturePad, /ล้างลายเซ็นต์/, 'the signer must be able to clear and redraw')
assert.doesNotMatch(signaturePad, /createBrowserClient|supabase\.from/, 'the browser must never talk to Supabase directly')

const requisitionActions = read('lib/requisitions/actions.ts')
const actorSource = read('lib/auth/actor.ts')
assert.match(actorSource, /name,dept,avatar_url/, 'the signed-in actor must carry profiles.dept')
assert.match(requisitionActions, /assertCreateItemScope/, 'the server must validate the selected department scope')
assert.match(requisitionActions, /requisition\.department/, 'the server must validate against the department selected in the form')
assert.match(requisitionActions, /export async function signRequisitionReceipt/)
assert.match(requisitionActions, /supabaseAdmin\.rpc\('sign_requisition_receipt'/)
assert.match(requisitionActions, /assertStockOperator/)

console.log('requisition UI: ok')
