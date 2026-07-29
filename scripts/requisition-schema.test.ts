import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_lab_stock_requisitions.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one requisitions migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')

const TABLES = ['requisitions', 'requisition_items', 'requisition_lot_allocations']

for (const table of TABLES) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'))
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'))
  assert.match(sql, new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'))
  assert.match(
    sql,
    new RegExp(`create policy ${table}_app_read\\s+on public\\.${table} for select\\s+to authenticated`, 'i'),
  )
}

assert.doesNotMatch(compactSql, /grant (?:select, )?(?:insert|update|delete)[^;]* to authenticated/i)
assert.doesNotMatch(
  compactSql,
  /create policy [^;]+ on public\.\w+ for (?:insert|update|delete|all) to authenticated/i,
)
assert.doesNotMatch(sql, /security definer/i)
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data/i)

for (const column of [
  'fiscal_year',
  'sequence_number',
  'document_number',
  'requester_id',
  'requester_name',
  'department',
  'desired_date',
  'status',
  'fulfilled_by',
  'fulfilled_at',
]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`), `requisitions must carry ${column}`)
}
for (const status of ['waiting', 'fulfilled', 'cancelled']) {
  assert.match(sql, new RegExp(`'${status}'`))
}
assert.match(sql, /unique \(fiscal_year, sequence_number\)/i)
assert.match(sql, /create unique index if not exists requisitions_document_number_key/i)

assert.match(sql, /requested_quantity numeric\(15,3\) not null check \(requested_quantity > 0\)/i)
assert.match(sql, /fulfilled_quantity numeric\(15,3\)/i)

// Allocations record the FIFO override and its reason.
assert.match(sql, /override_reason text/i)
assert.match(sql, /is_fifo_override boolean/i)
assert.match(
  sql,
  /is_fifo_override[\s\S]{0,160}override_reason/i,
  'an override must carry its reason as a database rule, not just UI copy',
)
assert.match(sql, /quantity numeric\(15,3\) not null check \(quantity > 0\)/i)
assert.match(sql, /create unique index if not exists requisition_lot_allocations_item_lot_key/i)

// Fulfilment is atomic, single-shot, and service-role only.
const fulfil = sql.match(
  /create or replace function public\.fulfill_requisition[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(fulfil, 'fulfill_requisition must exist')
assert.match(fulfil, /security invoker/i)
assert.match(fulfil, /set search_path = ''/i)
assert.match(fulfil, /assert_stock_officer_actor/i)
assert.match(fulfil, /for update/i)
assert.match(fulfil, /status <> 'waiting'/i)
assert.match(fulfil, /insert into public\.stock_movements/i)
assert.match(fulfil, /'requisition_issue'/i)
assert.match(fulfil, /insert into public\.requisition_lot_allocations/i)
assert.match(fulfil, /'fulfilled'/i)
assert.ok(
  fulfil.indexOf('for update') < fulfil.indexOf('insert into public.stock_movements'),
  'the requisition must be locked before any movement is written',
)
assert.match(fulfil, /expiry_date/i, 'expired lots must be rejected at the database, not only in the UI')
assert.match(fulfil, /expired lot cannot be issued/i)
// The lot must be locked before it is spent, not after.
assert.ok(
  fulfil.indexOf('from public.inventory_lots') <
    fulfil.indexOf('insert into public.requisition_lot_allocations'),
  'every selected lot must be locked before its allocation is written',
)
assert.match(fulfil, /from public\.inventory_lots[\s\S]{0,200}for update/i)

for (const fn of ['fulfill_requisition', 'create_requisition']) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from ${role}`, 'i'),
    )
  }
  assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`, 'i'))
}

for (const index of [
  'requisitions_status_idx',
  'requisitions_requester_idx',
  'requisition_items_requisition_idx',
  'requisition_lot_allocations_item_idx',
  'requisition_lot_allocations_lot_idx',
]) {
  assert.match(sql, new RegExp(`create index if not exists ${index}`, 'i'))
}

console.log(`requisition schema: ok (${migrationNames[0]})`)
