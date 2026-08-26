import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(path, 'utf8')
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) => name.endsWith('_inventory_lot_active.sql'))
assert.equal(migrationNames.length, 1, 'exactly one inventory lot active migration must exist')

const sql = read(join(migrationsDir, migrationNames[0]))
const functionBody = (name: string) => {
  const body = sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$function\\$;`, 'i'))?.[0]
  assert.ok(body, `${name} must exist in the lot active migration`)
  return body
}

assert.match(sql, /alter table public\.inventory_lots[\s\S]*add column if not exists is_active boolean not null default true/i)
assert.match(sql, /create index if not exists inventory_lots_active_fifo_idx/i)

const toggle = functionBody('set_inventory_lot_active')
assert.match(toggle, /security invoker/i)
assert.match(toggle, /set search_path = ''/i)
assert.match(toggle, /is_active\s*=\s*p_is_active/i)
assert.match(toggle, /updated_by\s*=\s*p_actor_id/i)
assert.match(toggle, /inventory lot not found/i)
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(sql, new RegExp(`revoke execute on function public\\.set_inventory_lot_active[\\s\\S]*?from ${role}`, 'i'))
}
assert.match(sql, /grant execute on function public\.set_inventory_lot_active[\s\S]*to service_role/i)

assert.match(sql, /create or replace view public\.inventory_item_requisition_availability/i)
assert.match(sql, /where lot\.is_active[\s\S]*lot\.expiry_date/i)
const availabilityGuard = functionBody('assert_requisition_stock_available')
assert.match(availabilityGuard, /lot\.is_active/i, 'reservation checks must ignore inactive lots')

const fifoGuard = functionBody('assert_requisition_fifo')
assert.match(fifoGuard, /inactive lot cannot be issued/i)
assert.match(fifoGuard, /lot\.is_active/i)

const inventoryQueries = read(join(process.cwd(), 'lib', 'inventory', 'queries.ts'))
assert.match(inventoryQueries, /storage_location, is_active/i)
assert.match(inventoryQueries, /isActive: lot\.is_active/i)

const requisitionQueries = read(join(process.cwd(), 'lib', 'requisitions', 'queries.ts'))
assert.match(requisitionQueries, /storage_location, is_active/i)
assert.match(requisitionQueries, /filter\(\(lot\) => lot\.is_active\)/i)
assert.match(requisitionQueries, /\.eq\('is_active', true\)/i)

const actions = read(join(process.cwd(), 'lib', 'inventory', 'actions.ts'))
assert.match(actions, /setInventoryLotActive/)
assert.match(actions, /assertStockOperator/)
assert.match(actions, /supabaseAdmin\.rpc\('set_inventory_lot_active'/)

const control = read(join(process.cwd(), 'components', 'inventory', 'InventoryLotActiveControl.tsx'))
assert.match(control, /^['"]use client['"]/m)
assert.match(control, /setInventoryLotActive/)
assert.match(control, /PowerIcon/)
assert.match(control, /role="alert"/)

console.log(`inventory lot management: ok (${migrationNames[0]})`)
