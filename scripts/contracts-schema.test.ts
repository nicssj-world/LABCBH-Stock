import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_lab_stock_contracts_and_access.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one contracts/access migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')

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
assert.match(sql, /create policy contracts_lab_stock_head_write[\s\S]+for update[\s\S]+to authenticated/i)
assert.match(sql, /create policy contracts_lab_stock_head_insert[\s\S]+for insert[\s\S]+to authenticated/i)
assert.match(sql, /create policy contracts_lab_stock_head_delete[\s\S]+for delete[\s\S]+to authenticated/i)
assert.match(sql, /revoke all on table public\.contracts from anon, authenticated/i)
assert.match(sql, /grant select, insert, update, delete on table public\.contracts to authenticated/i)

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

console.log(`contracts schema: ok (${migrationNames[0]})`)
