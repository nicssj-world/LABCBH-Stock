import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migrationsDir = join(root, 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_contract_inventory_item_source.sql'),
)

assert.equal(migrationNames.length, 1, 'exactly one contract/inventory source migration must exist')

const migration = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
assert.match(migration, /add column if not exists inventory_item_id uuid/i)
assert.match(migration, /contract_items_inventory_item_id_fkey/i)
assert.match(migration, /create trigger contract_items_link_inventory\s+before insert or update of inventory_item_id, ls_code/i)
assert.match(migration, /create trigger inventory_items_sync_contract_codes\s+after update of ls_code/i)
assert.match(migration, /inventory_item_aliases[\s\S]*inventory_code_sync/i)
assert.match(migration, /name_unit_candidates[\s\S]*having count\(distinct inventory\.id\) = 1/i)
assert.match(migration, /set ls_code = inventory\.ls_code/i)
assert.match(migration, /contract_items_inventory_item_id_required[\s\S]*not valid/i)

const prQueries = readFileSync(join(root, 'lib', 'pr', 'queries.ts'), 'utf8')
assert.match(prQueries, /inventory_item_id,\s*\n\s*ls_code/i)
assert.match(prQueries, /inventory_items \(id, ls_code\)/i)
assert.match(prQueries, /lsCode: row\.inventory_items\?\.ls_code \?\? row\.ls_code/i)

const contractQueries = readFileSync(join(root, 'lib', 'contracts', 'queries.ts'), 'utf8')
assert.match(contractQueries, /inventory_item_id,\s*\n\s*ls_code/i)
assert.match(contractQueries, /inventory_items \(ls_code\)/i)
assert.match(contractQueries, /lsCode: item\.inventory_items\?\.ls_code \?\? item\.ls_code/i)

console.log(`contract inventory source: ok (${migrationNames[0]})`)
