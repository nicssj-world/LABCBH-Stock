import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')

const migrationsDir = join(root, 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('_storage_cleanup_jobs.sql'))
  .sort()
  .at(-1)

assert.ok(migrationName, 'storage cleanup migration must exist')
const migration = read(join('supabase', 'migrations', migrationName))
const annualMigration = read('supabase/migrations/20260825182000_annual_plan_cleanup_retry.sql')

assert.match(migration, /create table public\.storage_cleanup_jobs/i)
assert.match(migration, /storage_backend text/i)
assert.match(migration, /available_at timestamptz/i)
assert.match(migration, /locked_until timestamptz/i)
assert.match(migration, /completed_at timestamptz/i)
assert.match(migration, /alter table public\.storage_cleanup_jobs enable row level security/i)
for (const rpc of [
  'enqueue_storage_cleanup_job',
  'claim_storage_cleanup_jobs',
  'complete_storage_cleanup_job',
  'cancel_storage_cleanup_job',
  'mark_purchase_request_upload_object_deleted',
]) {
  assert.match(migration, new RegExp(`function public\\.${rpc}\\(`), `${rpc} must exist`)
  assert.match(
    migration,
    new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to service_role`, 'i'),
    `${rpc} must only be callable by service_role`,
  )
}
assert.match(migration, /purchase_request_upload_tickets[\s\S]*object_deleted_at timestamptz/i)
assert.match(migration, /enqueue_purchase_request_upload_cleanup_job[\s\S]*storage_cleanup_jobs/i)
assert.match(migration, /sync_purchase_request_upload_cleanup_job[\s\S]*cancelled_at/i)

const routePath = 'app/api/internal/storage-cleanup/route.ts'
assert.equal(existsSync(join(root, routePath)), true, 'protected storage cleanup route must exist')
const route = read(routePath)
const proxy = read('proxy.ts')
assert.match(route, /export async function POST\(/)
assert.match(route, /CRON_SECRET/)
assert.match(route, /authorization/i)
assert.match(proxy, /api\/internal\/storage-cleanup/)
assert.match(route, /claim_storage_cleanup_jobs/)
assert.match(route, /DeleteObjectCommand/)
assert.match(route, /complete_storage_cleanup_job/)
assert.match(route, /cleanupPurchaseRequestChecklistObjects/)
assert.match(route, /cleanupTerminalPurchaseRequestPoFile/)
assert.match(route, /cleanupExpiredAnnualPlans/)
assert.match(route, /retryAnnualPlanHardDelete/)
assert.match(annualMigration, /annual_plan_retention_retry/i)
assert.match(annualMigration, /lab-stock-annual-plans/i)

const vercelConfig = read('vercel.ts')
assert.match(vercelConfig, /crons\s*:/)
assert.match(vercelConfig, /\/api\/internal\/storage-cleanup/)

for (const source of [
  read('lib/pr/po-file-actions.ts'),
  read('lib/contracts/file-actions.ts'),
  read('lib/out-lab/file-actions.ts'),
]) {
  assert.match(source, /enqueueStorageCleanupJob/, 'storage rollback failures must enter the cleanup queue')
}

assert.match(read('lib/pr/checklist-cleanup.ts'), /enqueueStorageCleanupJob/)
assert.match(read('lib/po/cleanup.ts'), /enqueueStorageCleanupJob/)
assert.doesNotMatch(read('lib/receipts/actions.ts'), /บันทึกรับเข้าคลังสำเร็จ แต่ล้างไฟล์ PO ไม่สำเร็จ/)
assert.doesNotMatch(read('lib/pr/actions.ts'), /(?:ปิดยอดคงเหลือ|รับของโดยหน่วยงาน)สำเร็จ แต่ล้างไฟล์ PO ไม่สำเร็จ/)

console.log('storage cleanup contract: ok')
