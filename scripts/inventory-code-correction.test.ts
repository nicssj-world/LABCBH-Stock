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

const noteMigrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_fix_lpst02_retired_note_encoding.sql'),
)
assert.equal(noteMigrationNames.length, 1, 'exactly one retired-note repair migration must exist')

const noteSql = readFileSync(join(migrationsDir, noteMigrationNames[0]), 'utf8')
assert.match(noteSql, /begin;/i)
assert.match(noteSql, /convert_from\(\s*decode\(\s*'[0-9a-f]+'\s*,\s*'hex'\s*\)/i)
assert.match(noteSql, /'UTF8'/i)
assert.match(noteSql, /LPST02-RETIRED-20260828/i)
assert.doesNotMatch(noteSql, /delete\s+from\s+public\.inventory_items/i)
assert.doesNotMatch(noteSql, /truncate\s+/i)

console.log(`retired note encoding repair: ok (${noteMigrationNames[0]})`)

const rewordMigrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_reword_lpst02_retired_note.sql'),
)
assert.equal(rewordMigrationNames.length, 1, 'exactly one retired-note reword migration must exist')

const rewordSql = readFileSync(join(migrationsDir, rewordMigrationNames[0]), 'utf8')
assert.match(rewordSql, /convert_from\(\s*decode\(\s*'[0-9a-f]+'\s*,\s*'hex'\s*\)/i)
assert.match(rewordSql, /'UTF8'/i)
assert.match(rewordSql, /LPST02-RETIRED-20260828/i)
assert.doesNotMatch(rewordSql, /delete\s+from\s+public\.inventory_items/i)
assert.doesNotMatch(rewordSql, /truncate\s+/i)

console.log(`retired note reword: ok (${rewordMigrationNames[0]})`)
