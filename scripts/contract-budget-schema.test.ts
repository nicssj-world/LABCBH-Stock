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

console.log('contract budget schema tests passed')
