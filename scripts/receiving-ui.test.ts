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
assert.match(listPage, /GoodsReceiptSummaryDialog receipt=\{receipt\}/, 'the list row must open the mini summary popup, not a plain PO cell')
assert.match(listPage, /DetailIconLink/, 'the receipt detail action must use the shared icon link')
assert.match(listPage, /GOODS_RECEIPT_STATUS_LABELS|GOODS_RECEIPT_STATUS_TONES/, 'the list page must use the shared receipts presenter, not a local status map')
assert.match(listPage, /className="data-table receipt-register-table"/, 'the receipt register must use a deliberate audit-and-queue layout')
assert.match(listPage, /<colgroup>[\s\S]*receipt-register-table__reference[\s\S]*receipt-register-table__action/, 'the receipt register must declare stable column widths')
assert.match(listPage, /สถานะการลงคลัง/, 'the register must make the next stock action visible')
assert.match(listPage, /formatThaiDateTime\(receipt\.postedAt\)/, 'posted receipts must show the stock-posting time in the queue')
assert.match(listPage, /canCreateGoodsReceipt/, 'heads may start a receipt draft from the register')
assert.doesNotMatch(listPage, /totalQuantity|รวมที่รับ|จำนวนล็อต/, 'the register must not show mixed-unit totals or redundant lot counts')

const receiptPresenter = read('lib/receipts/presenter.ts')
assert.match(receiptPresenter, /GOODS_RECEIPT_STATUS_LABELS/)
assert.match(receiptPresenter, /GOODS_RECEIPT_STATUS_TONES/)

const summaryDialog = read('components/receipts/GoodsReceiptSummaryDialog.tsx')
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
assert.match(summaryDialog, /StatusChip tone=\{GOODS_RECEIPT_STATUS_TONES/, 'status must never be a bare colored word')
assert.match(summaryDialog, /DetailIconLink/, 'the receipt popup detail route must use the shared icon link')
assert.match(summaryDialog, /รายการรับเข้า/, 'the receipt popup must show its receiving section')
assert.match(summaryDialog, /receipt\.items\.map/, 'the receipt popup must list every received reagent lot')
assert.match(summaryDialog, /ล็อต \{item\.lotNumber\}/, 'the receipt popup must keep the lot identity with each reagent')
assert.doesNotMatch(summaryDialog, /totalQuantity|รวมที่รับ|จำนวนล็อต/, 'the receipt popup must not show mixed-unit totals or redundant lot counts')

const newPage = read('app/(protected)/receipts/new/page.tsx')
assert.match(newPage, /ReceiptForm/)
assert.match(newPage, /DEPARTMENTS/)
assert.match(newPage, /departments=\{DEPARTMENTS\}/)
assert.match(newPage, /purchaseRequests=\{purchaseRequests\}/, 'the receipt form receives PR balances for partial receiving')
assert.match(newPage, /canCreateGoodsReceipt/, 'heads may open the receipt draft form')

const detailPage = read('app/(protected)/receipts/[id]/page.tsx')
assert.match(detailPage, /params:\s*Promise</)
assert.doesNotMatch(detailPage, /PO EVIDENCE|PoImageUploader|poUpload=failed/)
assert.match(detailPage, /ReceiptLinesEditor|ReceiptPostPanel/)
assert.match(detailPage, /formatThaiDateTime\(receipt\.cancelledAt\)/, 'the cancellation audit must show its time, not just its date')
assert.match(detailPage, /inline-alert--info/, 'posted receipts must explain the immutable correction path')
assert.match(detailPage, /contract-detail-heading__body--single/, 'the receipt detail header must not reserve space for a useless aggregate metric')
assert.match(detailPage, /รายการรับเข้า/, 'the receipt detail must name the actionable line-item section')
assert.doesNotMatch(detailPage, /totalQuantity|รวมที่รับเข้า|จำนวนล็อต/, 'the receipt detail must not show mixed-unit totals or redundant lot counts')
assert.match(
  detailPage,
  /ใบรับเข้านี้บันทึกเข้าคลังแล้ว จึงแก้ไขประวัติเดิมไม่ได้ หากยอดไม่ตรง ให้คลิกชื่อน้ำยาด้านล่าง แล้วเลือก “ปรับยอดคงคลัง” เพื่อเพิ่มหรือลดยอด พร้อมระบุเหตุผลทุกครั้ง/,
  'posted receipt guidance must explain the Thai correction path',
)
assert.doesNotMatch(detailPage, /Posted|ledger|ปรับยอด\/รับคืน/, 'posted receipt guidance must avoid technical English and ambiguous shorthand')
assert.match(detailPage, /inventory\/\$\{item\.inventoryItemId\}/, 'posted receipt lines must link to the audited inventory adjustment path')

const form = read('components/receipts/ReceiptForm.tsx')
assert.match(form, /^['"]use client['"]/m)
assert.match(form, /createGoodsReceipt/)
assert.doesNotMatch(form, /PoFileDropzone|uploadPoImage|preparePoFile|poFile/)
assert.match(form, /purchase-requests\/\$\{selectedRequest\.id\}/, 'the selected PR PO must link back to PR detail')
assert.match(form, /selectedRequest\.poNumber/, 'receipt creation derives the PO number from the selected PR')
assert.match(form, /ReceiptLinesEditor/)
assert.match(form, /setLines\(\[\]\)/, 'selecting a PR starts with no actual receipt lines')
assert.match(form, /receipt-pr-balance/, 'the selected PR must show a separate balance table')
assert.match(form, /item\.requestedQuantity/, 'the balance table retains the original requested quantity')
assert.match(form, /item\.receivedQuantity/, 'the balance table shows cumulative posted quantity')
assert.match(form, /item\.remainingQuantity/, 'the balance table shows the quantity still receivable')
assert.match(form, /addPurchaseRequestLine/, 'officers explicitly add only delivered items to the receipt')
assert.match(form, /showCatalogPicker=\{!selectedRequest\}/, 'a linked receipt cannot add an item outside its PR')
const balanceSection = form.match(/\{selectedRequest && \([\s\S]*?<ReceiptLinesEditor/)?.[0]
assert.ok(balanceSection, 'the selected PR balance section must exist before actual receipt lines')
assert.doesNotMatch(balanceSection, /lotNumber|expiryDate|ThaiDateInput/, 'unselected PR balances must create neither LOT nor expiry fields')
const linesEditor = read('components/receipts/ReceiptLinesEditor.tsx')
assert.match(linesEditor, /CatalogItemCombobox/, 'receiving items must be searchable by typing')
const catalogCombobox = read('components/ui/CatalogItemCombobox.tsx')
assert.match(catalogCombobox, /พิมพ์รหัสพัสดุ หรือชื่อรายการ/, 'receiving item search must provide a hint')
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
assert.doesNotMatch(linesEditor, /จัดเก็บที่/, 'storage location is not captured when receiving stock')
assert.match(linesEditor, /detectDuplicateLots/, 'duplicate lots must warn before posting')
assert.match(linesEditor, /ล็อตซ้ำ/)

// Receiving more of an item than its PR requested must block submission, even
// when the overage is split across two lots for the same reagent.
assert.match(form, /findOverRequestedItems/, 'the form must know when any line exceeds what the PR requested')
assert.match(
  form,
  /disabled=\{isPending \|\| lines\.length === 0 \|\| hasDuplicates \|\| hasIncompleteLot \|\| hasOverRequestedLine\}/,
  'submit must stay blocked while any line exceeds its PR-requested quantity',
)
assert.match(linesEditor, /findOverRequestedItems/)
assert.match(linesEditor, /เกินยอดคงเหลือที่รับได้/, 'the offending line must say it exceeds the current remainder')
assert.match(linesEditor, /ไม่มีอยู่ในใบ PR/, 'a linked receipt must flag an item that was not requested')

// The "ใบ PR ที่เกี่ยวข้อง" picker only offers PRs from the department
// currently receiving, so the list stays short as open PRs accumulate.
assert.match(form, /const \[department, setDepartment\] = useState\(initialDepartment \?\? initialRequest\?\.department \?\? ''\)/, 'the receiving department must be chosen explicitly or prefilled from a PR deep link')
assert.match(form, /initialPurchaseRequestId/, 'the receipt form accepts a PR deep-link selection')
assert.match(newPage, /searchParams/, 'the new-receipt page reads the PR deep-link query')
assert.match(form, /disabled=\{!department \|\| isPending\}/, 'the PR picker must wait for a department')
assert.ok(
  form.indexOf('หน่วยงานที่รับของ') < form.indexOf('ใบ PR ที่เกี่ยวข้อง'),
  'the receiving department field must appear before the PR picker',
)
assert.match(
  form,
  /departmentPurchaseRequests = purchaseRequests\.filter\(\(request\) => request\.department === department\)/,
  'the PR picker must be scoped to the receiving department',
)
assert.match(form, /departmentPurchaseRequests\.map/, 'the select must render the department-filtered list, not every PR')
assert.match(
  form,
  /selectedRequest\.department !== nextDepartment/,
  'switching department must clear a PR selection that no longer belongs to it',
)

const postPanel = read('components/receipts/ReceiptPostPanel.tsx')
assert.match(postPanel, /^['"]use client['"]/m)
assert.match(postPanel, /postGoodsReceipt/)
assert.match(postPanel, /cancelGoodsReceipt/, 'a draft can be cancelled from its review panel')
assert.match(postPanel, /หมายเหตุการยกเลิก \(ไม่บังคับ\)/, 'draft cancellation has an optional note')
assert.match(postPanel, /isPending/, 'posting must lock while in flight')

const actions = read('lib/receipts/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /supabaseAdmin\.rpc\('create_goods_receipt'/)
assert.match(actions, /supabaseAdmin\.rpc\('post_goods_receipt'/)
assert.match(actions, /supabaseAdmin\.rpc\('cancel_goods_receipt'/)
assert.match(actions, /assertStockOperator/)
assert.match(actions, /assertGoodsReceiptCreator/)
assert.doesNotMatch(actions, /uploadPoImage|getPoImageUrl|set_goods_receipt_image|isPoFileTypeAllowed|PO_MAX_FILE_SIZE_BYTES|isPoImagePathAllowed/)

const queries = read('lib/receipts/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /createClient/)
assert.match(queries, /department\?: string/, 'receipt queries accept a department filter')
assert.match(queries, /filters\.department/, 'receipt queries apply the department filter')
assert.match(queries, /purchase_request_items/, 'receivable PRs include their line items')
assert.match(
  queries,
  /purchase_requests!goods_receipts_purchase_request_id_fkey\s*\(/,
  'receipt reads must disambiguate the PR relationship after PR-owned PO audit FKs exist',
)
assert.match(queries, /from\('goods_receipts'\)[\s\S]*?purchase_request_id/, 'receivable PRs check existing receipt references')
assert.match(queries, /\.in\('status', \['completed', 'partially_received'\]\)/, 'confirmed and partially received PRs remain receivable')
assert.match(queries, /\.eq\('status', 'draft'\)/, 'only an open draft temporarily locks a PR')
assert.match(queries, /draftRequestIds/, 'posted and cancelled receipts do not remove a PR from the dropdown')
assert.match(queries, /remaining_quantity/, 'the query supplies the server-derived remainder')
assert.match(
  queries,
  /PURCHASE_METHODS_BY_PURPOSE\.purchase_order/,
  'a PR that opened a new contract (specific_contract/e_bidding) has no goods to receive and must not appear here',
)
assert.doesNotMatch(queries, /supabaseAdmin/, 'receipt reads stay under RLS')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/receipts/)

console.log('receiving UI: ok')
