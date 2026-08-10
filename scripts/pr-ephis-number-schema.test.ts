import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_pr_ephis_number.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one E-Phis PR number migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')

assert.match(sql, /alter table public\.purchase_requests\s+add column if not exists ephis_pr_number text/i)
assert.match(
  sql,
  /create unique index if not exists purchase_requests_ephis_pr_number_key\s+on public\.purchase_requests \(lower\(btrim\(ephis_pr_number\)\)\)\s+where ephis_pr_number is not null/i,
  'the E-Phis PR number must not collide across purchase requests',
)

const setFunction = sql.match(
  /create or replace function public\.set_ephis_pr_number[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(setFunction, 'set_ephis_pr_number must exist')
assert.match(setFunction, /security invoker/i)
assert.match(setFunction, /set search_path = ''/i)
assert.match(setFunction, /assert_stock_officer_actor/i, 'only a stock officer may record this number')
assert.doesNotMatch(
  setFunction,
  /contract_item_allocations/i,
  'recording an E-Phis PR number must not create or change an allocation',
)
// Unlike set_purchase_order_number, this must stay editable in every status —
// so the UPDATE must not gate on status at all.
assert.doesNotMatch(
  setFunction,
  /where id = p_pr_id\s+and status/i,
  'the E-Phis PR number must be editable regardless of the purchase request\'s status',
)

for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.set_ephis_pr_number\\([^)]*\\) from ${role}`, 'i'),
    `set_ephis_pr_number must be revoked from ${role}`,
  )
}
assert.match(
  sql,
  /grant execute on function public\.set_ephis_pr_number\([^)]*\) to service_role/i,
  'set_ephis_pr_number must be granted to service_role',
)

console.log('purchase request E-Phis number schema: ok')
