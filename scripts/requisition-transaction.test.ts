import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contract test for requisition fulfilment.
 *
 * The scenarios this protects: two officers fulfilling the same requisition at
 * once must produce exactly one set of issues; a partial multi-lot fulfilment
 * must drain lots without any of them going negative; and an expired lot must
 * be refused even if the UI offered it.
 *
 * NOTE: running those against a live Postgres needs `npx supabase db reset`,
 * scheduled for the staging pass in Task 12. Until a database is reachable this
 * asserts the properties the guarantees rest on.
 */

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const read = (suffix: string) => {
  const name = readdirSync(migrationsDir).find((file) => file.endsWith(suffix))
  assert.ok(name, `missing migration ${suffix}`)
  return readFileSync(join(migrationsDir, name), 'utf8')
}

const ledgerSql = read('_lab_stock_inventory_ledger.sql')
const requisitionSql = read('_lab_stock_requisitions.sql')
const fifoGuardSql = read('_requisition_fifo_guard.sql')

const fulfil = requisitionSql.match(
  /create or replace function public\.fulfill_requisition[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(fulfil, 'fulfill_requisition must exist')
assert.match(fulfil, /language plpgsql/i)

// 1. One shot only: the requisition row is locked and its status re-read under
//    that lock, so the loser of a race is rejected rather than issuing twice.
assert.match(fulfil, /from public\.requisitions[\s\S]*?for update/i)
assert.match(fulfil, /status <> 'waiting'/i)
assert.ok(
  fulfil.indexOf('for update') < fulfil.indexOf("status <> 'waiting'"),
  'status must be re-read under the lock, not before it',
)

// 2. Every selected lot is locked before its balance is trusted, so two
//    requisitions cannot both spend the same remaining units.
assert.match(fulfil, /from public\.inventory_lots[\s\S]{0,200}for update/i)

// 3. Negative stock is impossible regardless: the Task 5 guard runs before every
//    movement insert and re-derives the balance from the ledger under a lock.
assert.match(
  ledgerSql,
  /create trigger stock_movements_guard_balance\s+before insert on public\.stock_movements/i,
)
assert.match(ledgerSql, /lot balance cannot go negative/i)

// 4. Issues are negative movements tied to the requisition, so re-posting
//    collides with the source-document unique index instead of double-issuing.
assert.match(fulfil, /'requisition_issue'/i)
assert.match(fulfil, /source_document_id/i)
// The issue is recorded as a negated quantity, never as a positive one that
// some later reader has to remember to flip.
assert.match(
  fulfil,
  /'requisition_issue',\s*\n?\s*-\s*\w+/i,
  'the issue movement must be written with a negated quantity',
)
assert.match(
  ledgerSql,
  /movement_type = 'requisition_issue'[\s\S]{0,120}quantity < 0/i,
)

// 5. Fulfilled totals must equal what was requested; a short issue is refused.
assert.match(fulfil, /requested_quantity/i)
assert.match(fulfil, /does not match requested quantity/i)

// 6. Expired lots are refused at the database boundary.
assert.match(fulfil, /expired lot cannot be issued/i)

// 7. History stays append-only: nothing here deletes movements or allocations.
assert.doesNotMatch(
  fulfil,
  /delete from public\.(stock_movements|requisition_lot_allocations|inventory_lots)/i,
)
assert.match(
  ledgerSql,
  /create trigger stock_movements_append_only\s+before update or delete on public\.stock_movements/i,
)

// 8. FIFO is a database boundary, not only a client-side hint. The guard uses
// the same received-date/expiry/balance ordering and requires a reason for a
// usable lot skipped before a later selected lot.
assert.match(fifoGuardSql, /create or replace function public\.assert_requisition_fifo/i)
assert.match(fifoGuardSql, /left join public\.inventory_lot_balances/i)
assert.match(fifoGuardSql, /lot\.received_date asc[\s\S]*lot\.expiry_date asc nulls last/i)
assert.match(fifoGuardSql, /skipped_before_selected and not has_override_reason/i)
assert.match(fifoGuardSql, /create trigger requisition_lot_allocations_fifo_guard\s+before insert/i)
const guardedFulfil = fifoGuardSql.match(
  /create or replace function public\.fulfill_requisition[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(guardedFulfil, 'the FIFO guard migration must replace fulfill_requisition')
assert.match(guardedFulfil, /perform public\.assert_requisition_fifo\(line\.id, p_allocations\)/i)
assert.match(guardedFulfil, /public\.lab_stock_today\(\)/i)

console.log('requisition transaction contract: ok (static; live concurrency pass pending a database)')
