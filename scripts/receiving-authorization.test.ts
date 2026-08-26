import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { canCreateGoodsReceipt } from '../lib/auth/access'
import { assertGoodsReceiptCreator } from '../lib/receipts/authorization'
import type { Actor } from '../lib/auth/actor'

const actor = (appRoles: Actor['appRoles']): Actor => ({
  id: '11111111-1111-4111-8111-111111111111',
  ephisId: '10000',
  name: 'ผู้ใช้ทดสอบ',
  department: null,
  profileRole: 'Staff',
  appRoles,
})

assert.equal(canCreateGoodsReceipt(actor(['admin'])), true)
assert.equal(canCreateGoodsReceipt(actor(['stock_officer'])), true)
assert.equal(canCreateGoodsReceipt(actor(['head'])), false)
assert.equal(canCreateGoodsReceipt(actor(['viewer'])), false)
assert.doesNotThrow(() => assertGoodsReceiptCreator(actor(['admin'])))
assert.throws(() => assertGoodsReceiptCreator(actor(['head'])), /ไม่มีสิทธิ์สร้างใบรับเข้า/)
assert.throws(() => assertGoodsReceiptCreator(actor(['viewer'])), /ไม่มีสิทธิ์สร้างใบรับเข้า/)

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir).find((file) =>
  file.endsWith('_goods_receipt_creator_stock_only.sql'),
)
assert.ok(migrationName, 'the stock-only goods-receipt migration must exist')
const migration = readFileSync(join(migrationsDir, migrationName), 'utf8')

assert.match(migration, /create or replace function public\.assert_goods_receipt_creator_actor\(p_actor_id uuid\)/i)
assert.doesNotMatch(migration, /profile\.role\s*=\s*'Manager'/i)
assert.match(migration, /membership\.role in \('admin', 'stock_officer'\)/i)
assert.doesNotMatch(migration, /membership\.role in \('admin', 'stock_officer', 'head'\)/i)
assert.match(migration, /revoke execute on function public\.assert_goods_receipt_creator_actor\(uuid\) from public/i)
assert.match(migration, /grant execute on function public\.assert_goods_receipt_creator_actor\(uuid\) to service_role/i)

console.log('receiving authorization: ok')
