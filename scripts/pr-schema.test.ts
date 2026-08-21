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
const partialReceivingCompatibilityNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_partial_receiving_compatibility.sql'),
)
const partialReceivingBackfillNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_partial_receiving_backfill.sql'),
)
assert.equal(partialReceivingCompatibilityNames.length, 1, 'partial receiving needs one compatibility migration')
assert.equal(partialReceivingBackfillNames.length, 1, 'partial receiving backfill must be a separate migration')
const partialReceivingSql = readFileSync(join(migrationsDir, partialReceivingCompatibilityNames[0]), 'utf8')
const partialReceivingBackfillSql = readFileSync(join(migrationsDir, partialReceivingBackfillNames[0]), 'utf8')

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
for (const status of ['partially_received', 'received']) {
  assert.match(partialReceivingSql, new RegExp(`'${status}'`), `partial receiving must add ${status}`)
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
  partialReceivingSql,
  /add column if not exists received_quantity numeric\(15,3\) not null default 0/i,
  'each PR line must cache the quantity reconciled from posted receipts',
)
assert.match(
  partialReceivingSql,
  /remaining_quantity numeric\(15,3\)[\s\S]*?generated always as \(requested_quantity - received_quantity\) stored/i,
  'remaining quantity must be derived from requested minus posted received quantity',
)
assert.match(
  partialReceivingSql,
  /check \(received_quantity >= 0 and received_quantity <= requested_quantity\)/i,
  'the persisted quantity must never exceed its PR ceiling',
)
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

// "ซื้อในสัญญา" (contract) lines must always price at whatever the contract
// currently says, never at what the client submitted — every other method
// (annual_plan, awaiting_contract, off_plan, and the new-contract-origination
// methods) has no contract to check against and keeps trusting the payload.
const priceLockNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_pr_contract_line_price_lock.sql'),
)
assert.equal(priceLockNames.length, 1, 'exactly one PR contract-line price-lock migration must exist')

const priceLockSql = readFileSync(join(migrationsDir, priceLockNames[0]), 'utf8')
const priceLockCreatePr = priceLockSql.match(
  /create or replace function public\.create_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(priceLockCreatePr, 'create_purchase_request must be redefined to lock contract-line prices')

// The contract price is looked up before the payload's unitPrice is trusted.
assert.match(
  priceLockCreatePr,
  /resolved_contract_item_id := nullif\(line ->> 'contractItemId', ''\)::uuid;[\s\S]*?if resolved_contract_item_id is not null then/i,
)
assert.match(
  priceLockCreatePr,
  /select contract_item\.unit_price\s+into resolved_unit_price\s+from public\.contract_items contract_item\s+where contract_item\.id = resolved_contract_item_id/i,
)
assert.match(priceLockCreatePr, /if not found then\s*raise exception/i)

// Non-contract lines still trust the client-submitted price.
assert.match(
  priceLockCreatePr,
  /else\s*resolved_unit_price := \(line ->> 'unitPrice'\)::numeric;/i,
)

// The insert must use the resolved variable, not the raw payload value.
assert.match(
  priceLockCreatePr,
  /insert into public\.purchase_request_items \([\s\S]*?\)\s*values \([\s\S]*?resolved_unit_price\s*\);/i,
)
assert.doesNotMatch(
  priceLockCreatePr.split('insert into public.purchase_request_items')[1] ?? '',
  /\(line ->> 'unitPrice'\)::numeric/i,
  'the insert must not fall back to the raw payload price once resolved_unit_price exists',
)

assert.match(
  partialReceivingSql,
  /create trigger purchase_requests_guard_receipt_reversal[\s\S]*?before update of status/i,
  'receipt history must guard PR reversal at the database boundary',
)
assert.match(partialReceivingSql, /receipt\.status = 'posted'/i)
assert.match(partialReceivingSql, /receipt\.status = 'draft'/i)

assert.match(
  partialReceivingBackfillSql,
  /where receipt\.status = 'posted'/i,
  'backfill must count posted receipts only',
)
assert.match(partialReceivingBackfillSql, /then 'partially_received'/i)
assert.match(partialReceivingBackfillSql, /else 'received'/i)
assert.match(partialReceivingBackfillSql, /then 'completed'/i)

const integrityNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_pr_contract_integrity.sql'),
)
assert.equal(integrityNames.length, 1, 'exactly one PR contract-integrity migration must exist')
const integritySql = readFileSync(join(migrationsDir, integrityNames[0]), 'utf8')
const integrityCreatePr = integritySql.match(
  /create or replace function public\.create_purchase_request[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(integrityCreatePr, 'the contract-integrity migration must redefine PR creation')
assert.match(integritySql, /create or replace function public\.validate_purchase_request_contract/i)
assert.match(integritySql, /purchase_request_items_contract_integrity\s+on public\.purchase_request_items/i)
assert.match(integritySql, /contract_item_row\.contract_id is distinct from target_contract\.id/i)
assert.match(integritySql, /regexp_replace\(contract_item_row\.ls_code/i)
assert.match(integrityCreatePr, /perform public\.validate_purchase_request_contract/i)
assert.match(integrityCreatePr, /resolved_contract_id is distinct from parsed_contract_id/i)
assert.match(integritySql, /create or replace function public\.validate_contract_item_allocation/i)
assert.match(integritySql, /validate_purchase_request_contract\(\s*expected_contract_id/i)

// Editing replaces only an unconfirmed PR's lines, while cancellation keeps
// the document and its history instead of physically deleting it.
const editCancelNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_pr_edit_cancel.sql'),
)
assert.equal(editCancelNames.length, 1, 'exactly one PR edit/cancel migration must exist')
const editCancelSql = readFileSync(join(migrationsDir, editCancelNames[0]), 'utf8')
const managerFunction = editCancelSql.match(
  /create or replace function public\.assert_purchase_request_manager[\s\S]*?\$function\$;/i,
 )?.[0]
assert.ok(managerFunction, 'assert_purchase_request_manager must exist')
assert.match(managerFunction, /profile\.id = p_requester_id/i)
assert.match(managerFunction, /membership\.role in \('admin', 'stock_officer'\)/i)
const updatePr = editCancelSql.match(
  /create or replace function public\.update_purchase_request[\s\S]*?\$function\$;/i,
 )?.[0]
assert.ok(updatePr, 'update_purchase_request must exist')
assert.match(updatePr, /for update/i)
assert.match(updatePr, /status <> 'pending'/i)
assert.match(updatePr, /assert_purchase_request_manager\(p_actor_id, locked_request\.requester_id\)/i)
assert.doesNotMatch(updatePr, /assert_contract_editor_actor/i)
assert.match(updatePr, /delete from public\.purchase_request_items/i)
assert.match(updatePr, /insert into public\.purchase_request_items/i)

const cancelPr = editCancelSql.match(
  /create or replace function public\.cancel_purchase_request[\s\S]*?\$function\$;/i,
 )?.[0]
assert.ok(cancelPr, 'cancel_purchase_request must exist')
assert.match(cancelPr, /for update/i)
assert.match(cancelPr, /status <> 'pending'/i)
assert.match(cancelPr, /status = 'cancelled'/i)

for (const fn of ['assert_purchase_request_manager', 'update_purchase_request', 'cancel_purchase_request']) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      editCancelSql,
      new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from ${role}`, 'i'),
      `${fn} must be revoked from ${role}`,
    )
  }
  assert.match(
    editCancelSql,
    new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`, 'i'),
    `${fn} must be granted to service_role`,
  )
}

console.log(
  `purchase request schema: ok (${migrationNames[0]}, ${originationNames[0]}, ${leaseNames[0]}, ${methodCheckNames[0]}, ${priceLockNames[0]}, ${integrityNames[0]}, ${editCancelNames[0]})`,
)
