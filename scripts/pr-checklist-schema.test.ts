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
const overlapRuleMigration = readFileSync(
  join(migrationsDir, '20260825130000_purchase_request_committee_overlap_rule.sql'),
  'utf8',
)
const contractIdAmbiguityMigration = readFileSync(
  join(migrationsDir, '20260827042519_purchase_request_contract_id_ambiguity.sql'),
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
assert.match(sql, /other\.committee_kind = 'result'/, 'only result and inspection committees must be disjoint')
assert.doesNotMatch(sql, /other\.committee_kind in \('specification', 'result'\)/, 'specification and inspection committees may overlap')
assert.match(sql, /upload ticket expired/i, 'expired upload tickets must be rejected')
assert.match(sql, /contract committee roster is incomplete/i, 'contract PRs must fail closed without a roster')
assert.match(overlapRuleMigration, /apply_purchase_request_checklist/, 'existing checklist RPCs need the overlap-rule repair')
assert.match(overlapRuleMigration, /result committee cannot overlap inspection committee/, 'the overlap repair must preserve the result/inspection prohibition')
assert.doesNotMatch(sql, /delete\s+from\s+public\.contract_usage/i, 'the migration must never mutate contract_usage')
assert.match(rosterGuard, /expected_result_count/, 'contract roster must match its contract type')
assert.match(rosterGuard, /profile\.status <> 'active'/, 'contract roster inheritance must reject inactive personnel')
assert.match(rosterGuard, /before update of checklist_policy_version/, 'the roster guard must run inside checklist transactions')
assert.doesNotMatch(rosterGuard, /delete\s+from\s+public\.contract_usage/i, 'the roster guard must never mutate contract_usage')
assert.match(contractIdAmbiguityMigration, /apply_purchase_request_checklist/, 'the contract_id repair must rebuild the checklist RPC')
assert.match(
  contractIdAmbiguityMigration,
  /apply_purchase_request_checklist_with_contract_file/,
  'the contract_id repair must rebuild the shared-file RPC',
)
assert.match(contractIdAmbiguityMigration, /contract_id_value bigint/, 'contract checklist RPCs must use a distinct local variable')
assert.match(contractIdAmbiguityMigration, /committee\.contract_id = contract_id_value/, 'committee lookup must use the distinct variable')
assert.match(contractIdAmbiguityMigration, /where contract\.id = contract_id_value/, 'shared contract lookup must use the distinct variable')
assert.match(contractIdAmbiguityMigration, /attachment\.source_contract_id = contract_id_value/, 'attachment lookup must use the distinct variable')
assert.match(contractIdAmbiguityMigration, /contract_id_value::text/, 'shared contract path validation must use the distinct variable')

console.log('purchase request checklist schema: ok')
