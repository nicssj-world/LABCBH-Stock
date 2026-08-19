import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
assert.match(summaryDialog, /showModal\(\)/, 'the trigger must open it via showModal')
assert.match(summaryDialog, /list-summary-dialog/)
assert.match(summaryDialog, /StatusChip tone=\{REQUISITION_STATUS_TONES/, 'status must never be a bare colored word')
assert.match(summaryDialog, /DetailIconLink/, 'the requisition popup detail route must use the shared icon link')
assert.doesNotMatch(summaryDialog, /toDataURL|<img/, 'the popup must not render the signature image — keep it light, the full image lives on the detail page')
assert.match(newPage, /RequisitionForm/)
assert.match(newPage, /DEPARTMENTS/)
assert.match(newPage, /departments=\{DEPARTMENTS\}/)
assert.match(newPage, /note: item\.note/, 'the requisition catalog must carry each inventory note')

const form = read('components/requisitions/RequisitionForm.tsx')
assert.match(form, /departments: readonly string\[\]/)
assert.match(form, /<select required value=\{department\}/)
assert.match(form, /\{departments\.map\(\(department\)/)
assert.doesNotMatch(form, /<input type="text" required value=\{department\}/)
assert.match(form, /CatalogItemCombobox/, 'requisition items must be searchable by typing')
assert.match(form, /note: string \| null/, 'requisition catalog items must include the inventory note')
assert.match(form, /note: item\.note \?\? ''/, 'a new requisition line must start with the inventory note')
assert.match(form, /className="requisition-line__readonly-note"/, 'the line note must use the read-only style')
assert.match(form, /readOnly/, 'the inventory note field must not be editable')
const catalogCombobox = read('components/ui/CatalogItemCombobox.tsx')
assert.match(catalogCombobox, /พิมพ์รหัสพัสดุ หรือชื่อรายการ/, 'requisition item search must provide a hint')

// The item picker only offers what the requesting department is responsible
// for, so the list stays short as the catalog grows; items with no assigned
// department stay reachable from any department. If nothing matches at all
// (a department whose items were never tagged), fall back to the full catalog
// rather than leaving the picker silently empty.
assert.match(
  form,
  /scopedCatalog = catalog\.filter\(\s*\(item\) => item\.responsibleDepartment === null \|\| item\.responsibleDepartment === department,?\s*\)/,
  'the item picker must be scoped to the requesting department',
)
assert.match(
  form,
  /departmentCatalog = scopedCatalog\.length > 0 \? scopedCatalog : catalog/,
  'an empty department match must fall back to the full catalog, not an empty picker',
)
assert.match(form, /departmentCatalog\.map/, 'the picker options must come from the department-filtered catalog')
assert.match(form, /ยังไม่มีรายการน้ำยาในคลัง/)
assert.match(form, /showingUnfilteredCatalog/, 'the fallback to the unfiltered catalog must be explained to the requester')

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
assert.match(requisitionActions, /export async function signRequisitionReceipt/)
assert.match(requisitionActions, /supabaseAdmin\.rpc\('sign_requisition_receipt'/)
assert.match(requisitionActions, /assertStockOperator/)

console.log('requisition UI: ok')
