import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildPoImagePath, isPoImagePathAllowed } from '../lib/receipts/storage'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const name = readdirSync(migrationsDir).find((file) => file.endsWith('_lab_stock_receiving.sql'))
assert.ok(name, 'the receiving migration must exist')
const sql = readFileSync(join(migrationsDir, name), 'utf8')

// The bucket is private. A public bucket would expose every PO scan by URL.
assert.match(sql, /insert into storage\.buckets/i)
assert.match(sql, /'lab-stock-po'/)
assert.match(sql, /public\s*\)?\s*[,)]?[\s\S]{0,80}false/i)
assert.doesNotMatch(sql, /'lab-stock-po'[^;]*public[^;]*true/i)

// Upserting an image needs INSERT, SELECT, and UPDATE policies; without UPDATE a
// re-upload of the same path fails halfway.
for (const action of ['insert', 'select', 'update']) {
  assert.match(
    sql,
    new RegExp(`create policy lab_stock_po_\\w*${action}\\w*\\s+on storage\\.objects for ${action}`, 'i'),
    `storage objects need a ${action} policy`,
  )
}
assert.match(sql, /bucket_id = 'lab-stock-po'/i)
assert.match(sql, /lab_stock_memberships/i, 'storage access resolves through app membership')
assert.doesNotMatch(
  sql,
  /create policy lab_stock_po\w*\s+on storage\.objects for delete/i,
  'PO evidence is not deletable from the app',
)

// Paths are namespaced so one receipt cannot write into another's folder.
assert.equal(
  buildPoImagePath({ fiscalYear: 2569, receiptId: 'a1b2c3d4-0000-4000-8000-000000000000', fileName: 'po.jpg' }),
  'po/2569/a1b2c3d4-0000-4000-8000-000000000000/po.jpg',
)
assert.equal(
  buildPoImagePath({ fiscalYear: 2569, receiptId: 'a1b2c3d4-0000-4000-8000-000000000000', fileName: '../../escape.jpg' }),
  'po/2569/a1b2c3d4-0000-4000-8000-000000000000/escape.jpg',
  'traversal segments are stripped, never honoured',
)

const receiptId = 'a1b2c3d4-0000-4000-8000-000000000000'
assert.equal(isPoImagePathAllowed('po/2569/a1b2c3d4-0000-4000-8000-000000000000/po.jpg', 2569, receiptId), true)
assert.equal(
  isPoImagePathAllowed('po/2568/a1b2c3d4-0000-4000-8000-000000000000/po.jpg', 2569, receiptId),
  false,
  'a mismatched fiscal year is rejected',
)
assert.equal(
  isPoImagePathAllowed('po/2569/ffffffff-0000-4000-8000-000000000000/po.jpg', 2569, receiptId),
  false,
  'writing into another receipt folder is rejected',
)
assert.equal(
  isPoImagePathAllowed('po/2569/a1b2c3d4-0000-4000-8000-000000000000/../../po.jpg', 2569, receiptId),
  false,
  'traversal out of the receipt folder is rejected',
)
assert.equal(isPoImagePathAllowed('contracts/secret.pdf', 2569, receiptId), false)
assert.equal(isPoImagePathAllowed('', 2569, receiptId), false)

console.log('storage policy: ok')
