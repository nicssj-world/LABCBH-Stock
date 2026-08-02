import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const listPage = read('app/(protected)/receipts/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</)
assert.match(listPage, /listGoodsReceipts\(/)
assert.match(listPage, /ค้นหา/, 'officers search by PO, PR, LS code, or name')
assert.match(listPage, /หน่วยงาน/, 'officers can filter receipts by department')
assert.match(listPage, /AutoFilterBench/, 'receiving filters must update the list immediately')
assert.doesNotMatch(listPage, /แสดงผล/, 'receiving filters must not require an apply button')
assert.doesNotMatch(listPage, /^['"]use client['"]/m)

const newPage = read('app/(protected)/receipts/new/page.tsx')
assert.match(newPage, /ReceiptForm/)
assert.match(newPage, /DEPARTMENTS/)
assert.match(newPage, /departments=\{DEPARTMENTS\}/)
assert.match(newPage, /purchaseRequests=\{purchaseRequests\}/, 'the receipt form receives PR line items for auto-fill')
assert.match(newPage, /canOperateStock/, 'only stock officers and admins receive stock')

const detailPage = read('app/(protected)/receipts/[id]/page.tsx')
assert.match(detailPage, /params:\s*Promise</)
assert.match(detailPage, /PoImageUploader/)
assert.match(detailPage, /ReceiptLinesEditor|ReceiptPostPanel/)

const form = read('components/receipts/ReceiptForm.tsx')
assert.match(form, /^['"]use client['"]/m)
assert.match(form, /createGoodsReceipt/)
assert.match(form, /PoFileDropzone/, 'new receipts must accept PO attachments')
assert.match(form, /uploadPoImage/, 'the selected PO is uploaded after the draft is created')
assert.match(form, /ReceiptLinesEditor/)
assert.match(form, /request\?\.items/, 'selecting a PR auto-fills its receipt lines')
assert.match(form, /requestedQuantity|item\.quantity/, 'PR quantities are carried into the receipt draft')
const linesEditor = read('components/receipts/ReceiptLinesEditor.tsx')
assert.match(linesEditor, /CatalogItemCombobox/, 'receiving items must be searchable by typing')
const catalogCombobox = read('components/ui/CatalogItemCombobox.tsx')
assert.match(catalogCombobox, /พิมพ์รหัส LS หรือชื่อรายการ/, 'receiving item search must provide a hint')
const styles = read('app/globals.css')
assert.match(styles, /\.field-row input,\s*\.field-row select\s*\{[\s\S]*?height:\s*46px/, 'field inputs and selects must have equal height')
assert.match(styles, /\.form-grid\s*\{[^}]*align-items:\s*start;[^}]*\}/, 'form fields must share the same top alignment')
assert.match(styles, /\.field-row\s*\{[^}]*align-content:\s*start;[^}]*\}/, 'field content must stay aligned to the top of each grid cell')
assert.match(form, /departments: readonly string\[\]/)
assert.match(form, /<select required value=\{department\}/)
assert.match(form, /\{departments\.map\(\(department\)/)
assert.doesNotMatch(form, /<input type="text" required value=\{department\}/)
assert.doesNotMatch(form, /createBrowserClient|supabase\.from/)

assert.match(linesEditor, /เลขที่ล็อต/)
assert.match(linesEditor, /วันหมดอายุ/)
assert.match(linesEditor, /จัดเก็บที่/)
assert.match(linesEditor, /detectDuplicateLots/, 'duplicate lots must warn before posting')
assert.match(linesEditor, /ล็อตซ้ำ/)

const uploader = read('components/receipts/PoImageUploader.tsx')
assert.match(uploader, /^['"]use client['"]/m)
assert.match(uploader, /uploadPoImage/)
assert.match(uploader, /PoFileDropzone/, 'existing receipts must support drag-and-drop replacement')
assert.match(uploader, /preparePoFile/, 'PO images are prepared before upload')
assert.match(
  uploader,
  /ยังไม่ได้แนบไฟล์ PO|แนบไฟล์ PO/,
  'the uploader must state whether evidence is attached',
)

const dropzone = read('components/receipts/PoFileDropzone.tsx')
assert.match(dropzone, /onDrop/, 'PO files can be dragged onto the dropzone')
assert.match(dropzone, /application\/pdf/, 'PO uploads accept PDFs')
assert.match(dropzone, /ลากไฟล์ PO มาวางที่นี่/, 'the dropzone explains the drag-and-drop affordance')
const poFile = read('lib/receipts/po-file.ts')
assert.match(poFile, /canvas\.toBlob/, 'images are resized and recompressed in the browser')
assert.match(poFile, /application\/pdf/, 'PDFs bypass image resizing')

const postPanel = read('components/receipts/ReceiptPostPanel.tsx')
assert.match(postPanel, /^['"]use client['"]/m)
assert.match(postPanel, /postGoodsReceipt/)
assert.match(postPanel, /isPending/, 'posting must lock while in flight')

const actions = read('lib/receipts/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /supabaseAdmin\.rpc\('create_goods_receipt'/)
assert.match(actions, /supabaseAdmin\.rpc\('post_goods_receipt'/)
assert.match(actions, /supabaseAdmin\.rpc\('set_goods_receipt_image'/)
assert.match(actions, /assertStockOperator/)
assert.match(actions, /isPoFileTypeAllowed/, 'the server validates PO MIME types')
assert.match(actions, /PO_MAX_FILE_SIZE_BYTES/, 'the server enforces the PO size limit')
assert.match(actions, /isPoImagePathAllowed/, 'the server re-checks the upload path')
assert.match(
  actions,
  /createSignedUrl/,
  'private PO images are read through a short-lived signed URL',
)

const queries = read('lib/receipts/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /createClient/)
assert.match(queries, /department\?: string/, 'receipt queries accept a department filter')
assert.match(queries, /filters\.department/, 'receipt queries apply the department filter')
assert.match(queries, /purchase_request_items/, 'receivable PRs include their line items')
assert.match(queries, /from\('goods_receipts'\)[\s\S]*?purchase_request_id/, 'receivable PRs check existing receipt references')
assert.match(queries, /referencedRequestIds/, 'PRs already referenced by a receipt are removed from the dropdown')
assert.doesNotMatch(queries, /supabaseAdmin/, 'receipt reads stay under RLS')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/receipts/)

console.log('receiving UI: ok')
