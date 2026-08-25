import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(path, 'utf8')

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir).find((file) =>
  file.endsWith('_purchase_request_po_number_release.sql'),
)
assert.ok(migrationName, 'the PO-number release migration must exist')
const migration = read(join(migrationsDir, migrationName!))

assert.match(migration, /add column if not exists po_number_released_by/i)
assert.match(migration, /add column if not exists po_number_released_at/i)
assert.match(migration, /add column if not exists po_number_release_reason/i)
assert.match(
  migration,
  /drop index if exists public\.purchase_requests_po_number_key[\s\S]*?create unique index if not exists purchase_requests_po_number_key[\s\S]*?po_number_released_at is null/i,
  'released PO numbers must leave the active uniqueness index while remaining auditable',
)

const releaseFunction = migration.match(
  /create or replace function public\.release_purchase_order_number[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(releaseFunction, 'the release RPC must exist')
assert.match(releaseFunction!, /perform public\.assert_stock_officer_actor\(p_actor_id\)/i)
assert.match(releaseFunction!, /p_reason/i)
assert.match(releaseFunction!, /status not in \('cancelled', 'reversed'\)/i)
assert.match(releaseFunction!, /goods_receipts/i)
assert.match(releaseFunction!, /po_file_uploaded_at/i)
assert.match(releaseFunction!, /purchase_request_line_notifications/i)
assert.match(releaseFunction!, /po_number_release_reason/i)
assert.match(migration, /revoke execute on function public\.release_purchase_order_number/i)
assert.match(migration, /grant execute on function public\.release_purchase_order_number[\s\S]*?to service_role/i)

const actions = read('lib/pr/actions.ts')
assert.match(actions, /releasePurchaseOrderNumber/)
assert.match(actions, /supabaseAdmin\.rpc\('release_purchase_order_number'/)

const types = read('lib/pr/types.ts')
for (const field of ['poNumberReleasedBy', 'poNumberReleasedByName', 'poNumberReleasedAt', 'poNumberReleaseReason']) {
  assert.match(types, new RegExp(`\\b${field}\\b`), `PurchaseRequestRecord must expose ${field}`)
}

const queries = read('lib/pr/queries.ts')
for (const field of ['po_number_released_by', 'po_number_released_at', 'po_number_release_reason']) {
  assert.match(queries, new RegExp(`\\b${field}\\b`), `PR queries must select ${field}`)
}

const review = read('components/pr/PrReviewPanel.tsx')
assert.match(review, /releasePurchaseOrderNumber/)
assert.match(review, /ปลดเลข PO/)
assert.match(review, /เหตุผลที่ปลดเลข PO/)
assert.match(review, /poNumberReleaseReason/)
assert.match(review, /poNumberReleasedByName/)

console.log('purchase request PO number release: ok')
