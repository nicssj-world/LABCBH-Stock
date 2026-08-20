import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Out Lab register lives in its own tables so that nothing it does can
 * reach the portal's financial history. These assertions are mostly about what
 * the migration must *not* do — the separation is the whole reason the module
 * was built this way, and it is invisible in the schema unless someone checks.
 */
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((n) => n.endsWith('_lab_stock_out_lab.sql'))
assert.equal(names.length, 1, 'exactly one Out Lab table migration must exist')
const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')
const compact = sql.replace(/\s+/g, ' ')

// The header comment discusses public.contract_usage at length to explain why
// this register is separate. The "must not touch it" assertions below have to
// read the statements, not the prose about them.
const statements = sql.replace(/--[^\r\n]*/g, ' ').replace(/\s+/g, ' ')

for (const table of [
  'out_lab_contracts',
  'out_lab_monthly_usage',
  'out_lab_contract_stage_history',
  'out_lab_responsible_audit',
]) {
  assert.match(
    sql,
    new RegExp(`create table if not exists public\\.${table}`, 'i'),
    `${table} must be created`,
  )
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
    `${table} must have RLS enabled`,
  )
  assert.match(
    sql,
    new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'),
    `${table} must revoke the portal's blanket grants`,
  )
  assert.match(
    compact,
    new RegExp(`create policy ${table}_app_read on public\\.${table} for select`, 'i'),
    `${table} needs a read policy`,
  )
}

// One figure per contract per month is the rule the whole module is shaped
// around: it is what makes recording a month an upsert rather than an append.
assert.match(compact, /unique \(out_lab_contract_id, usage_month\)/i)

// contract_usage only enforces the first-of-month rule inside its RPC. This is
// a new table, so the rule lives where nothing can route around it — and the
// explicit ::timestamp cast is what keeps date_trunc IMMUTABLE enough for a
// CHECK constraint instead of resolving to the STABLE timestamptz overload.
assert.match(compact, /check \(usage_month = date_trunc\('month', usage_month::timestamp\)::date\)/i)

// An annual plan has no procurement stages. Enforced in the table, not only in
// the RPC and the UI, because hiding a button is not the same as making the
// state unreachable.
assert.match(compact, /constraint out_lab_contracts_kind_shape_check/i)
assert.match(compact, /kind = 'annual_plan' and procurement_stage is null/i)
assert.match(compact, /kind = 'contract_ceiling' and procurement_stage is not null/i)

// The two axes the register is built on.
assert.match(compact, /kind text not null check \(kind in \('contract_ceiling', 'annual_plan'\)\)/i)
assert.match(
  compact,
  /entry_cadence text not null check \(entry_cadence in \('monthly', 'quarterly', 'as_needed'\)\)/i,
)

// Both kinds carry a real period so every month-range guard downstream can use
// one code path; the RPC derives the fiscal-year bounds for an annual plan.
assert.match(compact, /start_date date not null/i)
assert.match(compact, /end_date date not null/i)

// Assigning the right to spend, and every stage transition, has to leave a
// trail that cannot be edited afterwards.
assert.match(sql, /out_lab_responsible_audit_append_only/i)
assert.match(sql, /out_lab_contract_stage_history_append_only/i)

// Authenticated clients read; every write goes through an RPC as service_role.
for (const table of ['out_lab_contracts', 'out_lab_monthly_usage']) {
  assert.match(
    sql,
    new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'),
  )
}
assert.doesNotMatch(
  compact,
  /grant (?:select, )?(?:insert|update|delete)[^;]* to authenticated/i,
  'authenticated must never receive a write grant',
)
assert.doesNotMatch(
  compact,
  /create policy [^;]+ for (?:insert|update|delete|all) to authenticated/i,
  'authenticated must never receive a write policy',
)

// Only is_current_lab_stock_admin() is allowed to be definer, and it is not here.
assert.doesNotMatch(sql, /security definer/i, 'Out Lab installs no security definer function')

// The portal's two years of financial history are out of bounds. The register
// is separate precisely so an Out Lab change can never reach them.
assert.doesNotMatch(
  statements,
  /public\.contract_usage/i,
  'Out Lab must not reference public.contract_usage',
)
assert.doesNotMatch(
  statements,
  /(insert into|update|delete from|alter table) public\.contracts\b/i,
  'Out Lab must not write to public.contracts',
)
assert.doesNotMatch(
  statements,
  /contracts_contract_type_check/i,
  'Out Lab must not widen the contract type allowlist',
)

console.log('out lab schema tests passed')
