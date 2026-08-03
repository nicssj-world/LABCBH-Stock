import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  setInventoryItemActiveInputSchema,
  updateInventoryItemInputSchema,
} from '../lib/inventory/schema'

// Editing and deactivating an inventory item: the item could previously be
// created but never edited or taken out of use again.

// updateInventoryItemInputSchema mirrors createInventoryItemInputSchema minus
// lsCode (immutable identity key) and minimumStockMonths (system-wide setting).
const validUpdate = {
  name: 'น้ำยาทดสอบ',
  baseUnit: 'ขวด',
  responsibleDepartment: 'งานเคมีคลินิก',
  defaultUnitPrice: 125.5,
  note: 'หมายเหตุทดสอบ',
}

assert.equal(updateInventoryItemInputSchema.safeParse(validUpdate).success, true)
assert.equal(
  updateInventoryItemInputSchema.safeParse({ ...validUpdate, name: '' }).success,
  false,
  'name is required',
)
assert.equal(
  updateInventoryItemInputSchema.safeParse({ ...validUpdate, baseUnit: '' }).success,
  false,
  'base unit is required',
)
assert.equal(
  updateInventoryItemInputSchema.safeParse({ ...validUpdate, defaultUnitPrice: -1 }).success,
  false,
  'price cannot be negative',
)
assert.equal(
  updateInventoryItemInputSchema.safeParse({ ...validUpdate, defaultUnitPrice: null }).success,
  true,
  'price may be unset',
)
assert.equal(
  updateInventoryItemInputSchema.safeParse({ ...validUpdate, lsCode: 'LS046022' }).success,
  false,
  'ls_code must not be editable through this schema',
)
assert.equal(
  updateInventoryItemInputSchema.safeParse({ ...validUpdate, minimumStockMonths: 2 }).success,
  false,
  'minimum stock months stays a system-wide setting, not per-item',
)

assert.equal(setInventoryItemActiveInputSchema.safeParse({ isActive: false }).success, true)
assert.equal(setInventoryItemActiveInputSchema.safeParse({ isActive: true }).success, true)
assert.equal(setInventoryItemActiveInputSchema.safeParse({}).success, false, 'isActive is required')

// The migration itself: both RPCs must exist, follow the service-role-only
// convention, and set_inventory_item_active must not touch ls_code.
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_inventory_item_update_and_deactivate.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one inventory item update/deactivate migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')

for (const functionName of ['update_inventory_item', 'set_inventory_item_active']) {
  const functionBody = sql.match(
    new RegExp(`create or replace function public\\.${functionName}[\\s\\S]*?\\$function\\$;`, 'i'),
  )?.[0]
  assert.ok(functionBody, `${functionName} body must exist`)
  assert.match(functionBody, /security invoker/i)
  assert.match(functionBody, /set search_path = ''/i)
  assert.match(functionBody, /inventory item not found/i)

  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${functionName}[\\s\\S]*?from[\\s\\S]*?${role}`, 'i'),
    )
  }
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*?to service_role`, 'i'),
  )
}

const updateFunction = sql.match(
  /create or replace function public\.update_inventory_item[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(updateFunction)
assert.doesNotMatch(updateFunction, /ls_code\s*=/i, 'ls_code must never be reassigned by update_inventory_item')
assert.match(updateFunction, /default unit price cannot be negative/i)

const activeFunction = sql.match(
  /create or replace function public\.set_inventory_item_active[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(activeFunction)
assert.match(activeFunction, /is_active\s*=\s*p_is_active/i)
assert.doesNotMatch(activeFunction, /\bname\s*=|base_unit\s*=|default_unit_price\s*=/i, 'the toggle must not touch item fields')

// UI: price now renders, and edit/deactivate controls exist and are permission-gated.
const table = readFileSync(join(process.cwd(), 'components', 'inventory', 'InventoryTable.tsx'), 'utf8')
assert.match(table, /formatBaht/, 'price must be rendered using the shared formatter')
assert.match(table, /ราคาต่อหน่วย/)
assert.match(table, /InventoryItemActiveControl/)
assert.match(table, /\/inventory\/\$\{item\.id\}\/edit/)

const detailPage = readFileSync(join(process.cwd(), 'app', '(protected)', 'inventory', '[id]', 'page.tsx'), 'utf8')
assert.match(detailPage, /formatBaht/, 'the detail page must show price too')
assert.match(detailPage, /InventoryItemActiveControl/)
assert.match(detailPage, /canOperateStock/, 'edit/deactivate controls must be gated by the stock-operator role')

const editPage = readFileSync(join(process.cwd(), 'app', '(protected)', 'inventory', '[id]', 'edit', 'page.tsx'), 'utf8')
assert.match(editPage, /canOperateStock/)
assert.match(editPage, /redirect\('\/access-denied'\)/)
assert.match(editPage, /mode="edit"/)

const form = readFileSync(join(process.cwd(), 'components', 'inventory', 'InventoryItemForm.tsx'), 'utf8')
assert.match(form, /updateInventoryItem/)
assert.match(form, /readOnly=\{mode === 'edit'\}/, 'ls_code must be read-only once editing an existing item')

const activeControl = readFileSync(join(process.cwd(), 'components', 'inventory', 'InventoryItemActiveControl.tsx'), 'utf8')
assert.match(activeControl, /^['"]use client['"]/m)
assert.match(activeControl, /setInventoryItemActive/)

const actions = readFileSync(join(process.cwd(), 'lib', 'inventory', 'actions.ts'), 'utf8')
assert.match(actions, /supabaseAdmin\.rpc\('update_inventory_item'/)
assert.match(actions, /supabaseAdmin\.rpc\('set_inventory_item_active'/)

console.log(`inventory item management: ok (${migrationNames[0]})`)
