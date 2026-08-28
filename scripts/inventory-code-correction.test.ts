import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_correct_lpst02_duplicate.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one LPST02 correction migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')

assert.match(sql, /begin;/i)
assert.match(sql, /do \$migration\$/i)
assert.match(sql, /commit;/i)
assert.match(sql, /where item\.ls_code = 'LSPT02'/i)
assert.match(sql, /where item\.ls_code = 'LPST02'/i)
assert.match(sql, /LPST02-RETIRED-20260828/i)
assert.match(sql, /order by item\.id\s+for update/i)
assert.match(sql, /v_duplicate_reference_count/i)
assert.match(sql, /inventory_item_aliases/i)
assert.match(sql, /stock_movements/i)
assert.match(sql, /requisition_items/i)
assert.match(sql, /contract_items/i)
assert.match(sql, /set[\s\S]*ls_code = v_retired_code/i)
assert.match(sql, /set ls_code = 'LPST02'/i)
assert.doesNotMatch(sql, /delete\s+from\s+public\.inventory_items/i)
assert.doesNotMatch(sql, /truncate\s+/i)

console.log(`inventory code correction: ok (${migrationNames[0]})`)
