import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir).find((file) =>
  file.endsWith('_grant_authenticated_lab_stock_today.sql'),
)

assert.ok(migrationName, 'the business-date grant migration must exist')
const sql = readFileSync(join(migrationsDir, migrationName), 'utf8')

// The availability view runs as the authenticated caller so its underlying
// inventory RLS remains active; that caller therefore needs this helper only.
assert.match(
  sql,
  /grant execute on function public\.lab_stock_today\(\) to authenticated/i,
)
assert.doesNotMatch(
  sql,
  /grant execute on function public\.lab_stock_today\(\) to (?:public|anon)/i,
  'the date helper must not become callable by anonymous clients',
)

console.log('requisition availability permissions: ok')
