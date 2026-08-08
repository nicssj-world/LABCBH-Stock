import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Records how much of a supply contract's line items were already used
// outside the system before an already-started contract (the admin fast path
// in create_contract) was registered here. Adds a fourth allocation_kind,
// 'opening_balance', to the existing ledger rather than a parallel table, so
// every existing guard (validate_contract_item_allocation's FOR UPDATE lock
// and over-allocation check, the append-only trigger, update_contract's
// cannot-remove-an-allocated-item check) applies to it for free.
//
// Proven against a real Postgres 17 container (base schema reconstructed from
// lab-management-portal's lib/seed/schema.sql plus the column-adding scripts
// LABCBH's own migrations assume already exist): all 34 prior migrations plus
// this one applied cleanly, and 14 scenarios covering the admin-only gate,
// the no-op-on-same-target and negative-delta-on-correction behaviour, the
// over-allocation guard, the cannot-remove-an-allocated-item guard, the
// lease/not-started/archived rejections, and inventory_lots/stock_movements
// staying untouched throughout all passed as designed.
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')

const migrationNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_contract_opening_balance.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one contract-opening-balance migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')

// Scope guard: this feature must never touch the stock ledger. It records a
// contractual commitment already spent outside the system, not a stock event.
assert.doesNotMatch(sql, /inventory_lots|stock_movements|inventory_item_balances/i)

// --- allocation_kind constraint widened, not replaced wholesale ---
assert.match(
  sql,
  /alter table public\.contract_item_allocations\s*drop constraint contract_item_allocations_allocation_kind_check;/i,
)
assert.match(
  sql,
  /add constraint contract_item_allocations_allocation_kind_check\s*check \(allocation_kind in \('purchase_request', 'reversal', 'legacy_import', 'opening_balance'\)\);/i,
)

assert.match(
  sql,
  /alter table public\.contract_item_allocations\s*drop constraint contract_item_allocations_check;/i,
)
const checkConstraint = sql.match(/add constraint contract_item_allocations_check\s*check \([\s\S]*?\)\s*\);/i)?.[0]
assert.ok(checkConstraint, 'the widened per-kind check constraint must exist')
// The three existing kinds keep every one of their original conditions.
assert.match(checkConstraint!, /allocation_kind = 'purchase_request'[\s\S]*?quantity > 0[\s\S]*?purchase_request_item_id is not null[\s\S]*?reference_allocation_id is null[\s\S]*?source_identity is null/i)
assert.match(checkConstraint!, /allocation_kind = 'legacy_import'[\s\S]*?nullif\(btrim\(source_identity\), ''\) is not null[\s\S]*?source_metadata <> '\{\}'::jsonb/i)
assert.match(checkConstraint!, /allocation_kind = 'reversal'[\s\S]*?quantity < 0[\s\S]*?reference_allocation_id is not null/i)
// The new kind: no fixed sign (a correction can lower the total), but must
// carry a note and structured metadata, and must not borrow the other kinds'
// linkage columns.
const openingArm = checkConstraint!.match(/allocation_kind = 'opening_balance'[\s\S]*?\)\s*\)/i)?.[0]
assert.ok(openingArm, 'opening_balance arm must exist')
assert.match(openingArm!, /purchase_request_item_id is null/i)
assert.match(openingArm!, /reference_allocation_id is null/i)
assert.match(openingArm!, /source_identity is null/i)
assert.match(openingArm!, /nullif\(btrim\(note\), ''\) is not null/i)
assert.match(openingArm!, /source_metadata <> '\{\}'::jsonb/i)
assert.doesNotMatch(openingArm!, /quantity [<>] 0/i)

// --- set_contract_opening_balances ---
const setFunction = sql.match(
  /create or replace function public\.set_contract_opening_balances[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(setFunction, 'set_contract_opening_balances body must exist')

// Admin-only, via the existing membership-admin assert — not the broader
// editor assert (which also lets head through) and not a bespoke check.
assert.match(setFunction!, /assert_lab_stock_admin_actor\(p_actor_id\)/i)
assert.doesNotMatch(setFunction!, /assert_contract_editor_actor/i)

assert.match(setFunction!, /opening balance note is required/i)
assert.match(setFunction!, /unexpected opening balance field/i)
assert.match(setFunction!, /invalid opening balance line/i)
assert.match(setFunction!, /duplicate contract item in opening balance lines/i)
assert.match(setFunction!, /contract not found/i)
assert.match(setFunction!, /archived contract cannot record an opening balance/i)
assert.match(setFunction!, /opening balance is only valid on a supply contract/i)
assert.match(setFunction!, /contract has not started/i)
assert.match(setFunction!, /contract item does not belong to contract/i)

// The contract row and each contract_items row are locked before their
// allocation sums are read, mirroring validate_contract_item_allocation's own
// FOR UPDATE discipline — required so two concurrent calls cannot both read
// the same "previous" total and double-apply a delta.
assert.ok(
  setFunction!.search(/from public\.contracts\s*where id = p_contract_id\s*for update/i) <
    setFunction!.search(/for line in select \* from jsonb_array_elements/i),
  'the contract row must be locked before iterating lines',
)
assert.ok(
  setFunction!.search(/from public\.contract_items\s*where id = line_item_id[\s\S]*?for update/i) <
    setFunction!.search(/coalesce\(sum\(quantity\), 0\)/i),
  'each contract item must be locked before its committed opening-balance total is summed',
)

// A repeated call with the same target must not insert a zero-quantity row —
// the check constraint would reject quantity = 0 outright, but the intent is
// a true no-op (continue), not relying on the constraint to catch it.
assert.match(setFunction!, /delta := target_quantity - previous_quantity;\s*if delta = 0 then\s*continue;/i)

assert.match(
  setFunction!,
  /allocation_kind = 'opening_balance'/i,
)

for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.set_contract_opening_balances[\\s\\S]*?from[\\s\\S]*?${role}`, 'i'),
  )
}
assert.match(
  sql,
  /grant execute on function public\.set_contract_opening_balances\(bigint, uuid, jsonb, date, text\) to service_role/i,
)

// --- create_contract: widened item allowlist, unchanged signature ---
const createFunction = sql.match(
  /create or replace function public\.create_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(createFunction, 'create_contract body must exist')

assert.match(
  createFunction!,
  /create or replace function public\.create_contract\(\s*p_actor_id uuid,\s*p_contract jsonb,\s*p_items jsonb,\s*p_effective_date date,\s*p_contract_number text default null\s*\)/i,
)

assert.match(
  createFunction!,
  /field_name not in \('lsCode', 'name', 'quantity', 'unit', 'unitPrice', 'openingUsedQuantity'\)/i,
)
assert.match(createFunction!, /invalid contract item opening balance/i)
assert.match(createFunction!, /opening balance requires an already-started contract/i)

// The opening-balance insert is a separate statement after the contract_items
// insert, joined back by (contract_id, line_number) — not folded into the
// same INSERT as a data-modifying CTE, because the allocation trigger reads
// contract_items with its own snapshot and would not see sibling-CTE rows yet.
const itemsInsertIndex = createFunction!.search(/insert into public\.contract_items \(/i)
const allocationsInsertIndex = createFunction!.search(/insert into public\.contract_item_allocations \(/i)
assert.ok(itemsInsertIndex >= 0 && allocationsInsertIndex > itemsInsertIndex, 'the opening-balance insert must come after the contract_items insert')
assert.match(
  createFunction!.slice(allocationsInsertIndex),
  /join public\.contract_items item_row\s*on item_row\.contract_id = created_contract\.id\s*and item_row\.line_number = item_order::integer/i,
)
assert.match(createFunction!.slice(allocationsInsertIndex), /'opening_balance'/i)

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

// --- update_contract left untouched: no opening-balance key on this path ---
const updateMigrationNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_contract_department_add_stock_and_poct.sql'),
)
assert.equal(updateMigrationNames.length, 1, 'exactly one migration defining the current update_contract must exist')
const updateSql = readFileSync(join(migrationsDir, updateMigrationNames[0]), 'utf8')
const updateFunction = updateSql.match(
  /create or replace function public\.update_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(updateFunction, 'update_contract body must exist')
assert.doesNotMatch(updateFunction!, /openingUsedQuantity/i)
assert.match(updateFunction!, /'id', 'lsCode', 'name', 'quantity', 'unit', 'unitPrice'/i)

console.log(`contract opening-balance RPC: ok (${migrationNames[0]})`)
