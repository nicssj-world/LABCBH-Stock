import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith('_purchase_request_acknowledger_snapshot.sql'),
)
assert.ok(migrationName, 'the PR acknowledger snapshot migration must exist')

const sql = readFileSync(join(migrationsDir, migrationName), 'utf8')
assert.match(sql, /add column if not exists acknowledged_by_name text/i)
assert.match(sql, /set acknowledged_by_name = nullif\(btrim\(profile\.name\), ''\)/i)
assert.match(sql, /create or replace function public\.snapshot_purchase_request_acknowledger_name/i)
assert.match(sql, /security definer/i)
assert.match(sql, /set search_path = ''/i)
assert.match(sql, /new\.acknowledged_by_name is distinct from old\.acknowledged_by_name/i)
assert.match(sql, /before insert or update of acknowledged_by, acknowledged_by_name on public\.purchase_requests/i)

const queries = readFileSync(join(process.cwd(), 'lib', 'pr', 'queries.ts'), 'utf8')
assert.match(queries, /acknowledged_by_name/)
assert.match(queries, /acknowledger:profiles!purchase_requests_acknowledged_by_fkey \(name, ephis_id\)/)
assert.match(queries, /row\.acknowledged_by_name\?\.trim\(\)/)

const types = readFileSync(join(process.cwd(), 'lib', 'pr', 'types.ts'), 'utf8')
assert.match(types, /acknowledgedByEphisId: string \| null/)

console.log(`PR acknowledger snapshot: ok (${migrationName})`)
