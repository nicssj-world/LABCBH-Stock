import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationPaths = [
  'supabase/migrations/20260818100000_set_stock_balance.sql',
  'supabase/migrations/20260818103000_require_lot_expiry_on_stock_balance.sql',
]

function withoutFunctionBodies(sql: string) {
  return sql.replace(/\$function\$[\s\S]*?\$function\$/gi, '$function$<body>$function$')
}

for (const path of migrationPaths) {
  const sql = readFileSync(path, 'utf8')
  const ddlOnly = withoutFunctionBodies(sql)

  assert.match(sql, /create or replace function public\.set_stock_balance\(/i, `${path} must define set_stock_balance`)
  assert.doesNotMatch(ddlOnly, /^\s*(insert into|update\s+public\.|delete from|truncate)\b/im, `${path} must not mutate data while applying`)
  assert.doesNotMatch(ddlOnly, /drop\s+table\b/i, `${path} must not drop a table`)
  assert.doesNotMatch(ddlOnly, /alter\s+table[\s\S]*?drop\s+column/i, `${path} must not drop a column`)
}

const expiryMigration = readFileSync(migrationPaths[1], 'utf8')
assert.match(expiryMigration, /p_lot_number\s+text/i)
assert.match(expiryMigration, /p_expiry_date\s+date/i)
assert.match(expiryMigration, /record_stock_adjustment/i)
assert.match(expiryMigration, /grant execute on function public\.set_stock_balance\([^;]+to service_role/i)

console.log('staging-schema-drift.test.ts: ok')
