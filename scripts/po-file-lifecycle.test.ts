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
assert.match(sql, /set_purchase_request_po_file/)
assert.match(sql, /clear_purchase_request_po_file/)
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
