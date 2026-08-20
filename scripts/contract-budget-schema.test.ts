import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((n) => n.endsWith('_lab_stock_contract_budget.sql'))
assert.equal(names.length, 1, 'exactly one contract budget migration must exist')
const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')

// The 180 existing rows must survive: additive column only, never a new table.
assert.match(sql, /alter table public\.contract_usage\s+add column if not exists recorded_by_id uuid/i)
assert.ok(
  !/create table if not exists public\.lab_stock_contract_expenses/i.test(sql),
  'contract_usage is reused, not replaced',
)
assert.ok(!/drop table[^;]*contract_usage/i.test(sql), 'contract_usage must never be dropped')

// Granting someone the right to spend against a contract has to leave a trail.
assert.match(sql, /create table if not exists public\.contract_responsible_audit/i)
for (const column of ['contract_id', 'profile_id', 'actor_id', 'previous_assigned', 'next_assigned']) {
  assert.match(sql, new RegExp(`\\b${column}\\b`), `audit table needs ${column}`)
}
assert.match(sql, /contract_responsible_audit_append_only/i)

// A contract must never carry both a budget balance and an allocation balance.
assert.match(sql, /contract_usage_mode_guard/i)
assert.match(sql, /contract_items_mode_guard/i)
assert.match(sql, /equipment_lease/i)

// Installing the guard over data it would already reject would half-apply the
// migration and leave a table nobody can write to.
assert.match(sql, /already mix budget and line-item tracking/i)

// RLS everywhere, service_role writes, authenticated reads only.
assert.match(sql, /alter table public\.contract_responsible_audit enable row level security/i)
assert.match(sql, /revoke all on table public\.contract_responsible_audit from anon, authenticated/i)

// Contract documents live in their own private bucket.
assert.match(sql, /insert into storage\.buckets[\s\S]*lab-stock-contracts/i)
assert.match(sql, /'lab-stock-contracts',\s*'lab-stock-contracts',\s*false/i)

// create_contract and update_contract both refused an empty item array, so a
// lease could not be created or edited at all. Fixing only the zod schema would
// have moved the failure from the form to the database.
const leaseNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_lab_stock_lease_without_items.sql'),
)
assert.equal(leaseNames.length, 1, 'exactly one lease-without-items migration must exist')
const leaseSql = readFileSync(join(migrationsDir, leaseNames[0]), 'utf8')

assert.match(leaseSql, /create or replace function public\.create_contract/i)
assert.match(leaseSql, /create or replace function public\.update_contract/i)

// Both directions: a lease needs no items, and must not be handed any.
const conditional =
  /jsonb_array_length\(p_items\) = 0\s+and \(p_contract ->> 'contractType'\) is distinct from 'equipment_lease'/gi
assert.equal(
  (leaseSql.match(conditional) ?? []).length,
  2,
  'both create and update must make the item requirement conditional',
)
const inverse = /an equipment lease contract cannot hold line items/gi
assert.equal(
  (leaseSql.match(inverse) ?? []).length,
  2,
  'both create and update must reject items on a lease',
)

const totalFixNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_contract_lease_total.sql'),
)
assert.equal(totalFixNames.length, 1, 'exactly one lease-total fix migration must exist')
const totalFixSql = readFileSync(join(migrationsDir, totalFixNames[0]), 'utf8')
assert.match(totalFixSql, /alter function public\.update_contract\([\s\S]*rename to update_contract_without_total/i)
assert.match(totalFixSql, /create or replace function public\.update_contract/i)
assert.match(totalFixSql, /contract total is required for an equipment lease/i)
assert.match(totalFixSql, /set total = parsed_total/i)
assert.match(totalFixSql, /public\.update_contract_without_total/i)


// A lease PR no longer states a ceiling, so the requirement has to be enforced
// where the contract becomes real. Without it, record_contract_expense's guard
// (`total is not null and committed + p_amount > total`) passes every entry on a
// started lease — the failure would be silent, not loud.
const startNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_lease_total_at_contract_start.sql'),
)
assert.equal(startNames.length, 1, 'exactly one lease-total-at-start migration must exist')
const startSql = readFileSync(join(migrationsDir, startNames[0]), 'utf8')

assert.match(
  startSql,
  /alter function public\.advance_contract_stage\([\s\S]*rename to advance_contract_stage_without_total/i,
  'the long transition body is wrapped, not rewritten',
)
assert.match(
  startSql,
  /p_total numeric default null/i,
  'advance_contract_stage must accept the ceiling',
)

// The lock has to be taken before the ceiling is read, or two officers could
// each see a null total and both decide the other would supply it.
const lockIndex = startSql.search(/where contract\.id = p_contract_id[\s\S]{0,80}?for update/i)
const guardIndex = startSql.search(/ต้องระบุมูลค่าสัญญาเมื่อเริ่มสัญญาเช่าเครื่อง/)
assert.ok(lockIndex > -1, 'the wrapper must lock the contract row')
assert.ok(guardIndex > -1, 'the wrapper must refuse to start a lease with no ceiling')
assert.ok(
  lockIndex < guardIndex,
  'the row lock must be taken before the ceiling is checked, not after',
)

assert.match(
  startSql,
  /if p_to_stage = 'contract_started' and target_contract\.contract_type = 'equipment_lease' then/i,
  'only a lease starting up needs a ceiling',
)
assert.match(
  startSql,
  /resolved_total := coalesce\(parsed_total, target_contract\.total\)/i,
  'a ceiling already recorded by the direct form satisfies the requirement',
)

// Relaxing update_contract is what keeps a mid-procurement lease editable at
// all; the started case must still refuse to have its ceiling cleared.
assert.match(
  startSql,
  /if target_contract\.procurement_stage = 'contract_started' then\s*raise exception[\s\S]{0,120}ต้องมีมูลค่าสัญญา/i,
  'a started lease must not be allowed to lose its ceiling',
)
assert.match(startSql, /clears_total/i, 'update_contract must distinguish an absent ceiling from a cleared one')

// Both wrappers stay service-role only, like every other write path here.
for (const grant of [
  /grant execute on function public\.advance_contract_stage\(bigint, uuid, text, date, text, numeric, text\)\s*to service_role/i,
  /revoke execute on function public\.advance_contract_stage_without_total\([^)]*\)\s*from public, anon, authenticated/i,
]) {
  assert.match(startSql, grant)
}

console.log('contract budget schema tests passed')
