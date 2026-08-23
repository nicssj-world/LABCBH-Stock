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
const prCard = read('components/pr/PurchaseRequestPoFileCard.tsx')

assert.match(prStorage, /buildPurchaseRequestPoFilePath/)
assert.match(prStorage, /isPurchaseRequestPoFilePathAllowed/)
assert.match(prStorage, /application\/pdf/)
assert.match(prStorage, /image\/jpeg|image\/png|image\/webp/)
assert.match(prActions, /uploadPurchaseRequestPoFile/)
assert.match(prActions, /getPurchaseRequestPoFileUrl/)
assert.match(prActions, /retryPurchaseRequestPoFileCleanup/)
assert.match(cleanup, /cleanupTerminalPurchaseRequestPoFile/)
assert.match(cleanup, /received|closed_short/)
assert.match(prCard, /เปิดไฟล์ PO/)
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
assert.match(sql, /grant execute on function public\.set_purchase_request_po_file[\s\S]*?to service_role/i)
assert.match(sql, /grant execute on function public\.clear_purchase_request_po_file[\s\S]*?to service_role/i)
assert.match(sql, /poNumber.*unexpected|unexpected.*poNumber/i)
assert.match(sql, /locked_request\.po_number/)
assert.match(sql, /closed_short/)

const form = read('components/receipts/ReceiptForm.tsx')
const detailPage = read('app/(protected)/receipts/[id]/page.tsx')
assert.doesNotMatch(form, /PoFileDropzone|uploadPoImage|preparePoFile|poFile/)
assert.doesNotMatch(detailPage, /PO EVIDENCE|PoImageUploader|poUpload=failed/)
assert.match(form, /purchase-requests\/\$\{selectedRequest\.id\}/)
assert.match(form, /selectedRequest\.poNumber/)

const prPage = read('app/(protected)/purchase-requests/[id]/page.tsx')
assert.match(prPage, /PurchaseRequestPoFileCard/)
assert.match(prPage, /request\.poFile/)

console.log('PR PO file lifecycle: ok')
