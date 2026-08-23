import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contract test for the atomic allocation path.
 *
 * The scenario this protects: a contract item holds 100 units, and two
 * pre-existing pending PRs for 70 and 40 are confirmed at once. Exactly one
 * must succeed and active allocations must never exceed 100. New PRs are now
 * reservation-checked before they can enter this state; this final allocation
 * guard still protects legacy rows and the confirmation race itself.
 *
 * NOTE: proving that against a live Postgres needs `npx supabase db reset` and
 * two concurrent sessions, which the plan schedules for the staging pass in
 * Task 12. Until a database is reachable this asserts the properties the
 * guarantee rests on: the row locks, their order, and the fact that the
 * over-allocation check runs inside the same transaction as the insert.
 */

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const read = (suffix: string) => {
  const name = readdirSync(migrationsDir).find((file) => file.endsWith(suffix))
  assert.ok(name, `missing migration ${suffix}`)
  return readFileSync(join(migrationsDir, name), 'utf8')
}

const accessSql = read('_lab_stock_contracts_and_access.sql')
const prSql = read('_lab_stock_purchase_requests.sql')
const sequenceSql = read('_contract_purchase_sequence.sql')

const createWithSequence = sequenceSql.match(
  /create or replace function public\.create_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(createWithSequence, 'the sequence migration must replace PR creation')
assert.match(createWithSequence, /purchase_method = 'contract'/i)
assert.match(createWithSequence, /status not in \('cancelled', 'reversed'\)/i)
assert.match(createWithSequence, /pg_advisory_xact_lock/i)
assert.match(createWithSequence, /jsonb_set[\s\S]*purchaseSequence/i)

// 1. The over-allocation ceiling is enforced by a trigger on the allocation
//    table itself, so no caller — RPC, import script, or manual fix — can slip
//    past it.
const validation = accessSql.match(
  /create or replace function public\.validate_contract_item_allocation[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(validation, 'the allocation validation trigger must exist')
assert.match(validation, /from public\.contract_items item[\s\S]*?for update/i)
assert.match(validation, /committed_quantity \+ new\.quantity > contracted_quantity/i)
assert.match(validation, /allocation exceeds contracted quantity/i)
assert.ok(
  validation.indexOf('for update') < validation.indexOf('sum(allocation.quantity)'),
  'the contract item must be locked before committed quantity is summed, or two ' +
    'confirmations can both read the same pre-allocation total',
)
assert.match(
  accessSql,
  /create trigger contract_item_allocations_validate_insert\s+before insert on public\.contract_item_allocations/i,
)

// 2. Confirmation itself is one statement-level transaction: a plpgsql function
//    body, so a failure on line two rolls back line one.
const confirm = prSql.match(
  /create or replace function public\.confirm_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(confirm, 'confirm_purchase_request must exist')
assert.match(confirm, /language plpgsql/i)
assert.match(confirm, /from public\.purchase_requests[\s\S]*?for update/i)

// 3. Losing the race must be rejected, not silently ignored: the PR row lock is
//    taken first and a non-pending status aborts.
assert.match(confirm, /status <> 'pending'/i)
assert.match(confirm, /raise exception/i)
assert.ok(
  confirm.indexOf('for update') < confirm.indexOf("status <> 'pending'"),
  'status must be re-read under the lock, not before it',
)

// 4. Double submission cannot create two allocations for one PR line.
assert.match(
  accessSql,
  /create unique index if not exists contract_item_allocations_pr_item_key\s+on public\.contract_item_allocations \(purchase_request_item_id\)\s+where allocation_kind = 'purchase_request'/i,
)

// 5. Reversal is bounded the same way: one reversal per original allocation,
//    and it must exactly negate it.
assert.match(
  accessSql,
  /create unique index if not exists contract_item_allocations_reversal_reference_key/i,
)
assert.match(validation, /reversal must exactly negate its original allocation/i)

// 6. History is append-only, so a lost race can never be tidied away.
assert.match(
  accessSql,
  /create trigger contract_item_allocations_append_only\s+before update or delete on public\.contract_item_allocations/i,
)

console.log('purchase request transaction contract: ok (static; live concurrency pass pending a database)')
