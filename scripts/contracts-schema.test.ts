import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_lab_stock_contracts_and_access.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one contracts/access migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')

for (const table of [
  'contract_items',
  'contract_stage_history',
  'contract_item_allocations',
  'lab_stock_memberships',
]) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'))
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
}

for (const column of [
  'fiscal_year',
  'contract_type',
  'procurement_stage',
  'display_name',
  'is_archived',
  'updated_at',
]) {
  assert.match(sql, new RegExp(`add column if not exists ${column}`, 'i'))
}

assert.match(sql, /where\s+contract_number\s+is\s+not\s+null/i)
assert.match(sql, /duplicate legacy contract numbers/i)
assert.doesNotMatch(sql, /alter\s+column\s+contract_number\s+set\s+not\s+null/i)
assert.match(sql, /alter column vendor drop not null/i)
assert.doesNotMatch(sql, /delete\s+from\s+public\.contracts/i)
assert.match(sql, /update\s+public\.contracts[\s\S]+contract_number\s*=\s*null[\s\S]+nullif\(btrim\(contract_number\),\s*''\)\s+is\s+null/i)
assert.match(sql, /contracts_stage_number_check/i)
assert.match(sql, /procurement_stage\s*=\s*'contract_started'[\s\S]+nullif\(btrim\(contract_number\),\s*''\)\s+is\s+not\s+null/i)
assert.match(sql, /procurement_stage\s*<>\s*'contract_started'[\s\S]+contract_number\s+is\s+null/i)

assert.match(sql, /drop policy if exists contracts_auth_read on public\.contracts/i)
assert.match(sql, /drop policy if exists contracts_staff_write on public\.contracts/i)
assert.match(sql, /create policy contracts_lab_stock_app_read[\s\S]+to authenticated/i)
assert.match(sql, /revoke all on table public\.contracts from anon, authenticated/i)

for (const role of ['admin', 'head', 'stock_officer', 'viewer', 'reporter']) {
  assert.match(sql, new RegExp(`'${role}'`, 'i'))
}
for (const ephisId of ['9495', '14812', '11050']) {
  assert.match(sql, new RegExp(`'${ephisId}'`))
}
assert.match(sql, /join\s+public\.profiles/i)
assert.match(sql, /p\.ephis_id/i)

assert.match(sql, /to\s+authenticated/i)
assert.match(sql, /grant\s+select[\s\S]+to\s+authenticated/i)
assert.match(sql, /grant[\s\S]+to\s+service_role/i)
assert.doesNotMatch(compactSql, /grant (?:select, )?(?:insert|update|delete)[^;]* to authenticated/i)
assert.doesNotMatch(compactSql, /create policy [^;]+ for (?:insert|update|delete|all) to authenticated/i)
assert.match(compactSql, /authenticated clients have select-only access; initial history is created atomically in task 3/i)
assert.match(sql, /create index if not exists[\s\S]+profile_id/i)
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data/i)

assert.match(
  sql,
  /create or replace function public\.advance_contract_stage\s*\([\s\S]+security invoker/i,
)
assert.match(sql, /for\s+update/i)
assert.match(sql, /revoke execute on function public\.advance_contract_stage[\s\S]+from public/i)
assert.match(sql, /revoke execute on function public\.advance_contract_stage[\s\S]+from anon/i)
assert.match(sql, /revoke execute on function public\.advance_contract_stage[\s\S]+from authenticated/i)
assert.match(sql, /grant execute on function public\.advance_contract_stage[\s\S]+to service_role/i)

assert.match(sql, /prevent_append_only_mutation/i)
assert.match(sql, /on public\.contract_stage_history/i)
assert.match(sql, /on public\.contract_item_allocations/i)

assert.match(sql, /purchase_request_item_id uuid(?!\s+not null)/i)
assert.match(sql, /allocation_kind\s*=\s*'purchase_request'[\s\S]+purchase_request_item_id\s+is\s+not\s+null/i)
assert.match(sql, /allocation_kind\s*=\s*'legacy_import'[\s\S]+purchase_request_item_id\s+is\s+null/i)
assert.match(sql, /source_metadata jsonb/i)

assert.match(sql, /max\(history\.effective_date\)/i)
assert.match(sql, /effective date cannot precede the latest contract history/i)
assert.match(sql, /membership\.role in \('admin', 'head'\)/i)
assert.match(sql, /profile\.role = 'Manager'/i)

for (const column of [
  'fiscal_year',
  'contract_type',
  'procurement_stage',
  'display_name',
  'is_archived',
  'updated_at',
  'portal_updated_at',
  'sent_to_procurement_date',
  'plan_published_date',
  'tender_announced_date',
  'result_consideration_date',
  'winner_announced_date',
  'contract_started_date',
  'stage_updated_at',
  'archived_at',
  'archived_by',
  'archive_reason',
]) {
  assert.match(sql, new RegExp(`add column if not exists ${column}`, 'i'))
  assert.doesNotMatch(sql, new RegExp(`add column if not exists ${column}[^,;]*not null`, 'i'))
  assert.doesNotMatch(sql, new RegExp(`alter column ${column} set not null`, 'i'))
}

assert.match(sql, /source_metadata jsonb/i)
assert.match(sql, /contract_stage_history[\s\S]+source text/i)
assert.match(sql, /contract_stage_history_source_idx/i)
assert.doesNotMatch(sql, /Backfilled from the legacy contract register/i)
assert.doesNotMatch(compactSql, /insert into public\.contract_stage_history[^;]+from public\.contracts/i)

const legacyContractBackfill = sql.match(
  /update\s+public\.contracts\s+set\s+fiscal_year[\s\S]*?;/i,
)?.[0]
assert.ok(legacyContractBackfill, 'legacy contract backfill must exist')
assert.match(legacyContractBackfill, /contract_started_date\s*=\s*coalesce\(contract_started_date,\s*start_date,\s*created_at::date\)/i)
for (const syntheticDate of [
  'sent_to_procurement_date',
  'plan_published_date',
  'tender_announced_date',
  'result_consideration_date',
  'winner_announced_date',
]) {
  assert.doesNotMatch(
    legacyContractBackfill,
    new RegExp(`${syntheticDate}\\s*=`, 'i'),
    `legacy backfill must not fabricate ${syntheticDate}`,
  )
}
assert.match(
  legacyContractBackfill,
  /where\s+contract_type\s+is\s+null\s+and\s+procurement_stage\s+is\s+null\s+and\s+display_name\s+is\s+null/i,
)

const lifecycleConstraintStart = sql.indexOf('add constraint contracts_lifecycle_status_date_check')
const lifecycleConstraintEnd = sql.indexOf(') not valid;', lifecycleConstraintStart)
assert.ok(lifecycleConstraintStart >= 0 && lifecycleConstraintEnd > lifecycleConstraintStart)
const lifecycleConstraint = sql.slice(lifecycleConstraintStart, lifecycleConstraintEnd)
const nonNullStageStatuses = lifecycleConstraint.match(
  /procurement_stage\s*=\s*'(?:sent_to_procurement|plan_published|tender_announced|result_consideration|winner_announced|contract_started)'\s+and\s+status\s+is\s+not\s+null\s+and\s+status\s+in/g,
) ?? []
assert.equal(nonNullStageStatuses.length, 6, 'every lifecycle branch must reject a null status')
const startedLifecycleStart = lifecycleConstraint.lastIndexOf("procurement_stage = 'contract_started'")
assert.ok(startedLifecycleStart >= 0, 'started lifecycle rule must exist')
const startedLifecycleRule = lifecycleConstraint.slice(startedLifecycleStart)
assert.match(startedLifecycleRule, /status in \('active', 'expired', 'cancelled'\)/i)
assert.match(startedLifecycleRule, /nullif\(btrim\(contract_number\), ''\) is not null/i)
assert.match(startedLifecycleRule, /start_date is not null/i)
assert.match(startedLifecycleRule, /contract_started_date is not null/i)
for (const historicalDate of [
  'sent_to_procurement_date',
  'plan_published_date',
  'tender_announced_date',
  'result_consideration_date',
  'winner_announced_date',
]) {
  assert.doesNotMatch(
    startedLifecycleRule,
    new RegExp(`${historicalDate}\\s+is\\s+not\\s+null`, 'i'),
    `started legacy rows must not require ${historicalDate}`,
  )
}

const rlsStart = sql.indexOf('drop policy if exists contracts_auth_read')
const rlsEnd = sql.indexOf('create or replace function public.advance_contract_stage')
const rlsSql = sql.slice(rlsStart, rlsEnd)
const membershipPredicates = rlsSql.match(/from public\.lab_stock_memberships membership/g) ?? []
const activeMembershipPredicates = rlsSql.match(/from public\.lab_stock_memberships membership\s+join public\.profiles membership_profile[\s\S]*?membership_profile\.status = 'active'[\s\S]*?membership_profile\.deleted_at is null/g) ?? []
assert.equal(activeMembershipPredicates.length, membershipPredicates.length)
assert.match(rlsSql, /profile_id = \(select auth\.uid\(\)\)[\s\S]+profile\.status = 'active'[\s\S]+profile\.deleted_at is null/i)

assert.match(sql, /source_identity text/i)
assert.match(sql, /contract_item_allocations_legacy_source_identity_key/i)
assert.match(sql, /contract_item_allocations_pr_item_key/i)
assert.match(sql, /contract_item_allocations_reversal_reference_key/i)
assert.match(sql, /validate_contract_item_allocation/i)
assert.match(sql, /for update/i)
assert.match(sql, /allocation exceeds contracted quantity/i)
assert.match(sql, /allocation would make committed quantity negative/i)
assert.match(sql, /reversal must exactly negate its original allocation/i)

assert.match(sql, /contracts_lifecycle_status_date_check/i)
assert.match(sql, /procurement_stage is null/i)
for (const column of [
  'plan_published_date',
  'tender_announced_date',
  'result_consideration_date',
  'winner_announced_date',
  'contract_started_date',
]) {
  assert.match(sql, new RegExp(`${column} = case`, 'i'))
}

console.log(`contracts schema: ok (${migrationNames[0]})`)
