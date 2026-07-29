import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_lab_stock_purchase_requests.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one purchase request migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')

const TABLES = ['purchase_requests', 'purchase_request_items']

for (const table of TABLES) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'))
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'))
  assert.match(sql, new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'))
  assert.match(
    sql,
    new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'),
  )
  assert.match(
    sql,
    new RegExp(`create policy ${table}_app_read\\s+on public\\.${table} for select\\s+to authenticated`, 'i'),
  )
}

assert.doesNotMatch(compactSql, /grant (?:select, )?(?:insert|update|delete)[^;]* to authenticated/i)
assert.doesNotMatch(compactSql, /create policy [^;]+ for (?:insert|update|delete|all) to authenticated/i)
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data/i)
assert.doesNotMatch(sql, /security definer/i)

// Header carries the fiscal-year document number and the snapshots the design
// requires, so a completed PR stays readable after profiles change.
for (const column of [
  'fiscal_year',
  'sequence_number',
  'document_number',
  'requester_id',
  'department',
  'head_name',
  'purchase_method',
  'method_details',
  'status',
  'po_number',
  'acknowledged_by',
  'acknowledged_at',
]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`), `purchase_requests must carry ${column}`)
}

for (const method of [
  'annual_plan',
  'contract',
  'awaiting_contract',
  'off_plan',
  'specific_contract',
  'e_bidding',
]) {
  assert.match(sql, new RegExp(`'${method}'`))
}
for (const status of ['draft', 'pending', 'completed', 'cancelled', 'reversed']) {
  assert.match(sql, new RegExp(`'${status}'`))
}

assert.match(sql, /create unique index if not exists purchase_requests_document_number_key/i)
assert.match(sql, /unique \(fiscal_year, sequence_number\)/i)

// Lines snapshot usage and on-hand at submission time.
for (const column of [
  'inventory_item_id',
  'contract_item_id',
  'monthly_usage_snapshot',
  'on_hand_snapshot',
  'requested_quantity',
  'unit_price',
  'line_total',
]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`), `purchase_request_items must carry ${column}`)
}
assert.match(sql, /requested_quantity numeric\(15,3\) not null check \(requested_quantity > 0\)/i)
assert.match(sql, /line_total numeric\(17,2\) generated always as/i)
assert.match(
  sql,
  /create unique index if not exists purchase_request_items_contract_item_key/i,
  'one PR cannot claim the same contract item twice',
)

// Now that the table exists, the Task 2 allocation column gets its real FK.
assert.match(
  sql,
  /alter table public\.contract_item_allocations[\s\S]*?foreign key \(purchase_request_item_id\)[\s\S]*?references public\.purchase_request_items\(id\)/i,
)

// Confirmation is atomic, service-role only, and locks before it validates.
const confirmFunction = sql.match(
  /create or replace function public\.confirm_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(confirmFunction, 'confirm_purchase_request must exist')
assert.match(confirmFunction, /security invoker/i)
assert.match(confirmFunction, /set search_path = ''/i)
assert.match(confirmFunction, /for update/i)
assert.match(confirmFunction, /assert_stock_officer_actor/i)
assert.match(confirmFunction, /status <> 'pending'/i)
assert.match(confirmFunction, /insert into public\.contract_item_allocations/i)
assert.match(confirmFunction, /'purchase_request'/i)
assert.match(confirmFunction, /'completed'/i)
assert.ok(
  confirmFunction.indexOf('for update') < confirmFunction.indexOf('insert into public.contract_item_allocations'),
  'the PR row must be locked before allocations are written',
)

// Reversal compensates; it never deletes allocation history.
const reverseFunction = sql.match(
  /create or replace function public\.reverse_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(reverseFunction, 'reverse_purchase_request must exist')
assert.match(reverseFunction, /'reversal'/i)
assert.match(reverseFunction, /reference_allocation_id/i)
assert.match(reverseFunction, /'reversed'/i)
assert.doesNotMatch(
  reverseFunction,
  /delete from public\.contract_item_allocations/i,
  'reversal must compensate, never delete',
)

// Attaching a PO number later must not touch allocations.
const poFunction = sql.match(
  /create or replace function public\.set_purchase_order_number[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(poFunction, 'set_purchase_order_number must exist')
assert.doesNotMatch(
  poFunction,
  /contract_item_allocations/i,
  'recording a PO number must not create or change an allocation',
)

for (const fn of [
  'assert_stock_officer_actor',
  'confirm_purchase_request',
  'reverse_purchase_request',
  'set_purchase_order_number',
  'create_purchase_request',
]) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from ${role}`, 'i'),
      `${fn} must be revoked from ${role}`,
    )
  }
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`, 'i'),
    `${fn} must be granted to service_role`,
  )
}

for (const index of [
  'purchase_requests_status_idx',
  'purchase_requests_requester_idx',
  'purchase_request_items_request_idx',
  'purchase_request_items_inventory_item_idx',
]) {
  assert.match(sql, new RegExp(`create index if not exists ${index}`, 'i'))
}

console.log(`purchase request schema: ok (${migrationNames[0]})`)
