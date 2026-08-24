import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(path, 'utf8')
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migration = readdirSync(migrationsDir).find((file) => file.includes('purchase_request_po_file_lifecycle'))
assert.ok(migration, 'the PR PO lifecycle migration must exist')
const sql = read(join(migrationsDir, migration!))

const prStorage = read('lib/po/storage.ts')
const prActions = read('lib/pr/po-file-actions.ts')
const cleanup = read('lib/po/cleanup.ts')
const receiptActions = read('lib/receipts/actions.ts')
const purchaseRequestActions = read('lib/pr/actions.ts')
const prCard = read('components/pr/PurchaseRequestPoFileCard.tsx')
const poFileOpenButton = read('components/pr/PurchaseRequestPoFileOpenButton.tsx')

assert.match(prStorage, /buildPurchaseRequestPoFilePath/)
assert.match(prStorage, /isPurchaseRequestPoFilePathAllowed/)
assert.match(prStorage, /application\/pdf/)
assert.match(prStorage, /image\/jpeg|image\/png|image\/webp/)
assert.match(prActions, /uploadPurchaseRequestPoFile/)
assert.match(prActions, /getPurchaseRequestPoFileUrl/)
assert.match(prActions, /retryPurchaseRequestPoFileCleanup/)
assert.match(cleanup, /cleanupTerminalPurchaseRequestPoFile/)
assert.match(cleanup, /received|closed_short/)
assert.match(cleanup, /\.list\(/, 'terminal cleanup must sweep replaced PR-owned objects, not only the latest pointer')
assert.match(cleanup, /isPurchaseRequestPoFilePathAllowed/)
assert.match(cleanup, /for \(const receipt of receipts\)/)
assert.match(cleanup, /isLegacyReceiptPoImagePathAllowed\(receipt\.po_image_path/)
assert.match(cleanup, /isMissingStorageObject/)
assert.match(receiptActions, /cleanupPoFileAfterPostedReceipt/)
assert.match(receiptActions, /การล้างไฟล์หลังรับเข้าไม่สำเร็จ/)
assert.match(purchaseRequestActions, /cleanupTerminalPurchaseRequestPoFile/)
assert.match(purchaseRequestActions, /closed_short/)
assert.match(prCard, /PurchaseRequestPoFileOpenButton/)
assert.match(poFileOpenButton, /เปิดไฟล์ PO/)
assert.match(prCard, /ลบไฟล์แล้วหลังบันทึกเข้าคลัง/)
assert.match(sql, /po_file_path/)
for (const field of [
  'po_file_name',
  'po_file_mime_type',
  'po_file_size_bytes',
  'po_file_checksum',
  'po_file_uploaded_by',
  'po_file_uploaded_at',
  'po_file_deleted_by',
  'po_file_deleted_at',
  'po_file_deletion_reason',
  'po_file_deleted_receipt_id',
]) {
  assert.match(sql, new RegExp(`\\b${field}\\b`))
}
assert.match(sql, /set_purchase_request_po_file/)
assert.match(sql, /clear_purchase_request_po_file/)
assert.match(sql, /po_file_deleted_receipt_id/)
assert.match(sql, /if locked_request\.po_file_deleted_at is null/)
assert.match(sql, /cleared_request := locked_request/)
assert.match(sql, /grant execute on function public\.set_purchase_request_po_file[\s\S]*?to service_role/i)
assert.match(sql, /grant execute on function public\.clear_purchase_request_po_file[\s\S]*?to service_role/i)
assert.match(sql, /unexpected goods receipt field/i)
assert.match(sql, /locked_request\.po_number/)
assert.match(sql, /closed_short/)
const lifecycleCreateGoodsReceipt = sql.match(
  /create or replace function public\.create_goods_receipt[\s\S]*?\$function\$;/i,
)
assert.ok(lifecycleCreateGoodsReceipt, 'the PR lifecycle migration must redefine receipt creation')
assert.doesNotMatch(lifecycleCreateGoodsReceipt[0], /'poNumber'/i)

const form = read('components/receipts/ReceiptForm.tsx')
const detailPage = read('app/(protected)/receipts/[id]/page.tsx')
assert.doesNotMatch(form, /PoFileDropzone|uploadPoImage|preparePoFile|poFile/)
assert.doesNotMatch(detailPage, /PO EVIDENCE|PoImageUploader|poUpload=failed/)
assert.match(form, /purchase-requests\/\$\{selectedRequest\.id\}/)
assert.match(form, /selectedRequest\.poNumber/)

const prPage = read('app/(protected)/purchase-requests/[id]/page.tsx')
const prReview = read('components/pr/PrReviewPanel.tsx')
assert.doesNotMatch(prPage, /<PurchaseRequestPoFileCard/, 'PO file controls must not render above the stock officer panel')
assert.match(prReview, /PurchaseRequestPoFileCard/)
assert.match(prReview, /request\.poFile/)

console.log('PR PO file lifecycle: ok')
