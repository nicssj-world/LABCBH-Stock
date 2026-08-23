import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('_purchase_request_checklist.sql'))
  .sort()
  .at(-1)

assert.ok(migrationName, 'purchase request checklist migration must exist')
const sql = readFileSync(join(migrationsDir, migrationName), 'utf8')
const rosterGuard = readFileSync(
  join(migrationsDir, '20260824123000_purchase_request_contract_roster_guard.sql'),
  'utf8',
)

for (const table of [
  'purchase_request_upload_tickets',
  'purchase_request_attachments',
  'purchase_request_committees',
  'contract_committees',
  'purchase_request_checklist_events',
]) {
  assert.match(sql, new RegExp(`create table public\\.${table}`), `${table} must be created`)
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${table} must enable RLS`)
}

for (const rpc of [
  'register_purchase_request_checklist_upload',
  'create_purchase_request_with_checklist',
  'update_purchase_request_with_checklist',
  'confirm_purchase_request_with_committees',
  'set_contract_committees',
  'mark_purchase_request_checklist_objects_deleted',
]) {
  assert.match(sql, new RegExp(`function public\\.${rpc}\\(`), `${rpc} RPC must exist`)
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to service_role`, 'i'),
    `${rpc} must only be exposed through the service role`,
  )
}

assert.match(sql, /checklist_policy_version integer/, 'new PRs must carry a policy version')
assert.match(sql, /position_title/, 'committee confirmation must validate personnel positions')
assert.match(sql, /50_000|50000/, 'quotation threshold must be enforced in SQL')
assert.match(sql, /100_000|100000/, 'committee threshold must be enforced in SQL')
assert.match(sql, /upload ticket expired/i, 'expired upload tickets must be rejected')
assert.match(sql, /contract committee roster is incomplete/i, 'contract PRs must fail closed without a roster')
assert.doesNotMatch(sql, /delete\s+from\s+public\.contract_usage/i, 'the migration must never mutate contract_usage')
assert.match(rosterGuard, /expected_result_count/, 'contract roster must match its contract type')
assert.match(rosterGuard, /profile\.status <> 'active'/, 'contract roster inheritance must reject inactive personnel')
assert.match(rosterGuard, /before update of checklist_policy_version/, 'the roster guard must run inside checklist transactions')
assert.doesNotMatch(rosterGuard, /delete\s+from\s+public\.contract_usage/i, 'the roster guard must never mutate contract_usage')

console.log('purchase request checklist schema: ok')
