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

// A specific_contract/e_bidding PR opens a brand-new contract the moment the
// stock officer confirms it — same row lock, same transaction as everything
// else confirm_purchase_request does, redefined in a later migration.
const originationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_pr_contract_origination.sql'),
)
assert.equal(originationNames.length, 1, 'exactly one PR contract-origination migration must exist')

const originationSql = readFileSync(join(migrationsDir, originationNames[0]), 'utf8')

assert.match(originationSql, /alter table public\.contracts\s+add column if not exists sent_to_stock_officer_date date/i)
assert.match(
  originationSql,
  /alter table public\.purchase_requests\s+add column if not exists created_contract_id bigint references public\.contracts\(id\)/i,
)

const originationConfirm = originationSql.match(
  /create or replace function public\.confirm_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(originationConfirm, 'confirm_purchase_request must be redefined to accept a sent-to-procurement date')
assert.match(originationConfirm, /security invoker/i)
assert.match(originationConfirm, /set search_path = ''/i)
assert.match(originationConfirm, /p_sent_to_procurement_date date default null/i)

// The row must be locked and re-checked before create_contract is ever
// called, or two officers racing the same PR could both open a contract.
assert.ok(
  originationConfirm.indexOf('for update') < originationConfirm.indexOf('public.create_contract('),
  'the PR row must be locked before a contract is opened from it',
)
assert.ok(
  originationConfirm.indexOf("status <> 'pending'") < originationConfirm.indexOf('public.create_contract('),
  'status must be re-read under the lock before a contract is opened',
)

// The requester (already vetted by assert_contract_editor_actor when they
// submitted the PR) becomes the contract's actor — not the confirming stock
// officer, who create_contract's own assert_contract_editor_actor would reject.
assert.match(originationConfirm, /public\.create_contract\(\s*locked_request\.requester_id/i)
assert.match(originationConfirm, /'specific_contract'/i)
assert.match(originationConfirm, /'e_bidding'/i)
assert.match(originationConfirm, /sent_to_stock_officer_date = \(contract_draft ->> 'sentToStockOfficerDate'\)::date/i)

assert.match(originationSql, /drop function if exists public\.confirm_purchase_request\(uuid, uuid\)/i)
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    originationSql,
    new RegExp(`revoke execute on function public\\.confirm_purchase_request\\(uuid, uuid, date\\) from ${role}`, 'i'),
  )
}
assert.match(
  originationSql,
  /grant execute on function public\.confirm_purchase_request\(uuid, uuid, date\) to service_role/i,
)

// An equipment-lease PR originates a contract too, but has zero reagent
// lines — the ceiling lives on the contract draft itself instead.
const leaseNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_pr_lease_origination.sql'),
)
assert.equal(leaseNames.length, 1, 'exactly one PR lease-origination migration must exist')

const leaseSql = readFileSync(join(migrationsDir, leaseNames[0]), 'utf8')

const leaseCreatePr = leaseSql.match(
  /create or replace function public\.create_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(leaseCreatePr, 'create_purchase_request must be redefined to allow a lease with zero items')
assert.match(leaseCreatePr, /jsonb_array_length\(p_items\) = 0 and parsed_method <> 'equipment_lease'/i)
assert.match(leaseCreatePr, /jsonb_array_length\(p_items\) > 0 and parsed_method = 'equipment_lease'/i)

const leaseConfirm = leaseSql.match(
  /create or replace function public\.confirm_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(leaseConfirm, 'confirm_purchase_request must be redefined for the lease branch')
assert.match(leaseConfirm, /'specific_contract', 'e_bidding', 'equipment_lease'/i)
assert.match(
  leaseConfirm,
  /if locked_request\.purchase_method <> 'equipment_lease' then[\s\S]*?jsonb_agg/i,
  'a lease must never aggregate purchase_request_items into contract_items',
)
assert.match(
  leaseConfirm,
  /'contractType', 'equipment_lease'[\s\S]*?'total', contract_draft -> 'total'/i,
  'the lease branch must pass the ceiling through to create_contract',
)

const leaseCreateContract = leaseSql.match(
  /create or replace function public\.create_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(leaseCreateContract, 'create_contract must be redefined to accept an optional total')
assert.match(
  leaseCreateContract,
  /field_name not in \('fiscalYear', 'contractType', 'department', 'displayName', 'vendor', 'endDate', 'total'\)/i,
)
assert.match(
  leaseCreateContract,
  /p_contract \? 'total' and \(p_contract ->> 'contractType'\) is distinct from 'equipment_lease'/i,
  'total must be rejected outright for any non-lease contract type',
)
assert.match(
  leaseCreateContract,
  /if parsed_contract_type = 'equipment_lease' then\s*parsed_total := round\(nullif\(p_contract ->> 'total', ''\)::numeric, 2\);/i,
)

// The table-level check constraint on purchase_method is separate from the
// RPCs' own jsonb-payload validation — 20260803150000 taught the RPCs about
// 'equipment_lease' but missed this constraint, so every lease PR insert was
// rejected at the database before the RPC logic ever ran.
const methodCheckNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_pr_lease_purchase_method_check.sql'),
)
assert.equal(methodCheckNames.length, 1, 'exactly one PR purchase_method check-constraint fix must exist')

const methodCheckSql = readFileSync(join(migrationsDir, methodCheckNames[0]), 'utf8')
assert.match(methodCheckSql, /drop constraint purchase_requests_purchase_method_check/i)
assert.match(methodCheckSql, /add constraint purchase_requests_purchase_method_check/i)
assert.match(methodCheckSql, /'equipment_lease'/)

console.log(
  `purchase request schema: ok (${migrationNames[0]}, ${originationNames[0]}, ${leaseNames[0]}, ${methodCheckNames[0]})`,
)
