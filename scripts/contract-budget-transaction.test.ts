import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The portal enforced the over-budget rule inside an API handler, where two
 * simultaneous requests each read the same remaining balance and both passed.
 * Moving the check into the RPC is only a fix if it runs under a lock on the
 * contract row, in the same transaction as the insert. That is what this
 * asserts, alongside the permission union the workflow depends on.
 *
 * The live two-session proof runs against a throwaway postgres:17 container;
 * see the Task 3 commit message for its recorded output.
 */
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_lab_stock_contract_budget_rpc.sql'),
)
assert.equal(names.length, 1, 'exactly one contract budget RPC migration must exist')
const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')
const compact = sql.replace(/\s+/g, ' ')

// The contract row is locked before the remaining balance is computed.
assert.match(compact, /from public\.contracts contract where contract\.id = p_contract_id for update/i)
const lockAt = compact.search(/for update/i)
const sumAt = compact.search(/coalesce\(sum\(usage\.amount\), 0\)/i)
assert.ok(lockAt >= 0 && sumAt > lockAt, 'the lock must be taken before the total is summed')

// Insert happens in the same function, so it cannot be separated from the check.
assert.match(compact, /insert into public\.contract_usage/i)
assert.match(compact, /raise exception[^;]*errcode = '23514'/i)

// Responsible users can record against their own contract without being editors.
assert.match(sql, /create or replace function public\.assert_contract_expense_actor/i)
assert.match(compact, /responsible_user_ids/i)
assert.match(compact, /assert_contract_editor_actor/i)

// Reassignment writes an audit row per added and per removed person.
assert.match(sql, /create or replace function public\.set_contract_responsible_users/i)
assert.match(compact, /insert into public\.contract_responsible_audit/i)

// Only the service role may execute these.
for (const fn of [
  'assert_contract_expense_actor',
  'record_contract_expense',
  'delete_contract_expense',
  'set_contract_responsible_users',
  'set_contract_file',
]) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.${fn}[^;]*from public, anon, authenticated`, 'i'),
    `${fn} must be revoked from authenticated`,
  )
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${fn}[^;]*to service_role`, 'i'),
    `${fn} must be granted to service_role`,
  )
}

console.log('contract budget transaction tests passed')
