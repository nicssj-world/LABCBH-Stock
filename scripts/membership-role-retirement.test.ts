import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const migrationPath = 'supabase/migrations/20260801165404_retire_reporter_role.sql'
assert.ok(existsSync(migrationPath), 'the retirement migration must exist')

const migration = readFileSync(migrationPath, 'utf8')
assert.match(migration, /delete from public\.lab_stock_memberships\s+where role = 'reporter'/i)
assert.match(migration, /check \(role in \('admin', 'head', 'stock_officer', 'viewer'\)\)/i)
assert.match(migration, /if p_role not in \('admin', 'head', 'stock_officer', 'viewer'\) then/i)

console.log('membership role retirement: ok')
