import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_lab_stock_inventory_ledger.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one inventory ledger migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')

const TABLES = ['inventory_items', 'inventory_item_aliases', 'inventory_lots', 'stock_movements']

for (const table of TABLES) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'))
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'))
  assert.match(sql, new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'))
  assert.match(
    sql,
    new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'),
  )
}

// Authenticated clients stay read-only; every mutation runs through a service-role RPC.
assert.doesNotMatch(compactSql, /grant (?:select, )?(?:insert|update|delete)[^;]* to authenticated/i)
assert.doesNotMatch(compactSql, /create policy [^;]+ for (?:insert|update|delete|all) to authenticated/i)
for (const table of TABLES) {
  assert.match(
    sql,
    new RegExp(`create policy ${table}_app_read\\s+on public\\.${table} for select\\s+to authenticated`, 'i'),
  )
}

// Every read policy reuses the active-membership predicate proven in the contracts migration.
const policyStart = sql.indexOf('create policy inventory_items_app_read')
const policySql = sql.slice(policyStart)
const membershipPredicates = policySql.match(/from public\.lab_stock_memberships membership/g) ?? []
assert.equal(membershipPredicates.length, TABLES.length, 'each table gets its own membership predicate')
const activeMembershipPredicates =
  policySql.match(
    /from public\.lab_stock_memberships membership\s+join public\.profiles membership_profile[\s\S]*?membership_profile\.status = 'active'[\s\S]*?membership_profile\.deleted_at is null/g,
  ) ?? []
assert.equal(activeMembershipPredicates.length, membershipPredicates.length)
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data/i)

// Canonical catalog: LS codes are unique case-insensitively and aliases absorb Sheet variants.
assert.match(sql, /create unique index if not exists inventory_items_ls_code_normalized_key/i)
assert.match(sql, /upper\(regexp_replace\(ls_code, '\[\^a-za-z0-9\]', '', 'g'\)\)/i)
assert.match(sql, /minimum_stock_months numeric\(6,2\) not null default 1\.5/i)
assert.match(sql, /minimum_stock_override numeric\(15,3\)/i)
assert.match(sql, /minimum_stock_override is null or minimum_stock_override >= 0/i)
assert.match(sql, /responsible_department text/i)
assert.match(sql, /base_unit text not null/i)
assert.match(sql, /is_active boolean not null default true/i)

// Balances are never stored; they are always summed from the ledger.
assert.doesNotMatch(
  sql.slice(sql.indexOf('create table if not exists public.inventory_items'), sql.indexOf('create table if not exists public.inventory_item_aliases')),
  /\b(on_hand|current_balance|quantity_on_hand)\b/i,
  'inventory_items must not carry a mutable balance column',
)
assert.doesNotMatch(
  sql.slice(sql.indexOf('create table if not exists public.inventory_lots'), sql.indexOf('create table if not exists public.stock_movements')),
  /\b(on_hand|current_balance|remaining_quantity)\b/i,
  'inventory_lots must not carry a mutable balance column',
)

// Ledger integrity: fixed signs per movement type, append-only, and source-document uniqueness.
for (const movementType of [
  'goods_receipt',
  'requisition_issue',
  'opening_adjustment',
  'manual_adjustment',
  'reversal',
]) {
  assert.match(sql, new RegExp(`'${movementType}'`))
}
assert.match(sql, /movement_type = 'goods_receipt'[\s\S]{0,120}quantity > 0/i)
assert.match(sql, /movement_type = 'requisition_issue'[\s\S]{0,120}quantity < 0/i)
assert.match(sql, /movement_type = 'opening_adjustment'[\s\S]{0,120}quantity > 0/i)
assert.match(sql, /quantity <> 0/i)
assert.match(sql, /create unique index if not exists stock_movements_source_document_key/i)
assert.match(sql, /create unique index if not exists stock_movements_reversal_reference_key/i)
assert.match(sql, /prevent_append_only_mutation/i)
assert.match(
  sql,
  /create trigger stock_movements_append_only\s+before update or delete on public\.stock_movements/i,
)

// On-hand can never go negative, for either the lot or the item.
assert.match(sql, /create or replace function public\.guard_stock_movement_balance/i)
assert.match(sql, /security invoker/i)
assert.match(sql, /set search_path = ''/i)
assert.match(sql, /for update/i)
assert.match(sql, /lot balance cannot go negative/i)
assert.match(sql, /item on-hand cannot go negative/i)
assert.match(
  sql,
  /create trigger stock_movements_guard_balance\s+before insert on public\.stock_movements/i,
)
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.guard_stock_movement_balance\\(\\) from ${role}`, 'i'),
  )
}

// Adjustments are audited and service-role only.
assert.match(sql, /create or replace function public\.record_stock_adjustment\s*\(/i)
const adjustmentFunction = sql.match(
  /create or replace function public\.record_stock_adjustment[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(adjustmentFunction, 'record_stock_adjustment must exist')
assert.match(adjustmentFunction, /security invoker/i)
assert.match(adjustmentFunction, /p_actor_id uuid/i)
assert.match(adjustmentFunction, /p_reason text/i)
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.record_stock_adjustment[\\s\\S]*?from ${role}`, 'i'),
  )
}
assert.match(sql, /grant execute on function public\.record_stock_adjustment[\s\S]*?to service_role/i)

assert.match(sql, /create or replace function public\.set_inventory_minimum_stock\s*\(/i)
assert.match(sql, /grant execute on function public\.set_inventory_minimum_stock[\s\S]*?to service_role/i)
assert.match(sql, /create table if not exists public\.inventory_minimum_stock_audit/i)

// Derived balances are views over the ledger, and they must not bypass RLS.
for (const view of [
  'inventory_item_balances',
  'inventory_lot_balances',
  'inventory_item_monthly_issues',
]) {
  assert.match(sql, new RegExp(`create or replace view public\\.${view}\\s+with \\(security_invoker = true\\)`, 'i'))
  assert.match(sql, new RegExp(`revoke all on public\\.${view} from anon, authenticated`, 'i'))
  assert.match(sql, new RegExp(`grant select on public\\.${view} to authenticated`, 'i'))
}
assert.doesNotMatch(sql, /security_definer/i, 'no view or function may escalate past the caller')

// Indexes back every policy column and hot read path.
for (const index of [
  'inventory_items_active_department_idx',
  'inventory_item_aliases_item_idx',
  'inventory_lots_item_expiry_idx',
  'stock_movements_item_idx',
  'stock_movements_lot_idx',
]) {
  assert.match(sql, new RegExp(`create index if not exists ${index}`, 'i'))
}

// Lots stay linkable to Task 7 receiving without depending on it yet.
assert.match(sql, /goods_receipt_item_id uuid/i)
assert.doesNotMatch(sql, /goods_receipt_item_id uuid not null/i)
assert.match(sql, /expiry_date date/i)
assert.match(sql, /received_date date not null/i)
assert.match(sql, /original_quantity numeric\(15,3\) not null check \(original_quantity > 0\)/i)
assert.match(sql, /storage_location text/i)
assert.match(sql, /unique \(inventory_item_id, lot_number\)/i)

console.log(`inventory schema: ok (${migrationNames[0]})`)
