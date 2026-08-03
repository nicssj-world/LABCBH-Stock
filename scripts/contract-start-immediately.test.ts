import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Admins can create a contract that has already started (contract number
// known up front) instead of walking it through the five procurement stages.
// It adds a trailing default parameter to create_contract, must gate the
// fast path behind an admin-only check narrower than
// assert_contract_editor_actor, must reject a duplicate contract number, and
// must record exactly one collapsed stage-history row.
//
// Adding that parameter did NOT turn out to be a true replace: Postgres
// identifies a function by name plus argument *type list*, so a 4-argument
// call became ambiguous between the old 4-argument function and the new
// 5-argument one (last argument defaulted) — "is not unique" at runtime.
// 20260803170000_drop_stale_create_contract_overload.sql drops the stale
// 4-argument overload; this file checks that it actually happened.
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')

const migrationNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_contract_start_immediately.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one contract-start-immediately migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')

const createFunction = sql.match(
  /create or replace function public\.create_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(createFunction, 'create_contract body must exist')

// Adds a trailing default parameter only — a true replace, not a new overload.
assert.match(
  createFunction,
  /create or replace function public\.create_contract\(\s*p_actor_id uuid,\s*p_contract jsonb,\s*p_items jsonb,\s*p_effective_date date,\s*p_contract_number text default null\s*\)/i,
)

assert.match(createFunction, /assert_contract_editor_actor/i)

// Admin-only gate, narrower than assert_contract_editor_actor: no 'Manager'/head branch.
const fastPathGuard = createFunction.match(
  /if normalized_contract_number is not null then[\s\S]*?end if;\s*end if;/i,
)?.[0]
assert.ok(fastPathGuard, 'fast-path admin guard must exist')
assert.match(fastPathGuard, /profile\.ephis_id\s*=\s*'9495'/i)
assert.match(fastPathGuard, /membership\.role\s*=\s*'admin'/i)
assert.doesNotMatch(fastPathGuard, /'Manager'/i)
assert.doesNotMatch(fastPathGuard, /membership\.role\s+in\s*\('admin',\s*'head'\)/i)
assert.match(fastPathGuard, /is not allowed to create an already-started contract/i)

// Duplicate contract number is rejected.
assert.match(createFunction, /contract number is already in use/i)

// Fast path lands directly on contract_started/active with a single collapsed history row.
assert.match(createFunction, /'contract_started'\s+else\s+'sent_to_procurement'\s+end/i)
assert.match(createFunction, /'active'\s+else\s+'pending'\s+end/i)
assert.match(
  createFunction,
  /insert into public\.contract_stage_history[\s\S]*?values\s*\(\s*created_contract\.id,\s*null,/i,
)

for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.create_contract[\\s\\S]*?from[\\s\\S]*?${role}`, 'i'),
  )
}
assert.match(
  sql,
  /grant execute on function public\.create_contract\(uuid, jsonb, jsonb, date, text\) to service_role/i,
)

const dropOverloadNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_drop_stale_create_contract_overload.sql'),
)
assert.equal(dropOverloadNames.length, 1, 'exactly one migration dropping the stale 4-arg create_contract must exist')
assert.ok(
  Number(dropOverloadNames[0].slice(0, 14)) > Number(migrationNames[0].slice(0, 14)),
  'the overload must be dropped after this migration introduced the ambiguity, not before',
)

const dropOverloadSql = readFileSync(join(migrationsDir, dropOverloadNames[0]), 'utf8')
assert.match(dropOverloadSql, /drop function if exists public\.create_contract\(uuid, jsonb, jsonb, date\)/i)

console.log(`contract start-immediately RPC: ok (${migrationNames[0]}, ${dropOverloadNames[0]})`)
