import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_kpi_dashboard_security_invoker.sql'),
)
assert.equal(names.length, 1, 'create exactly one KPI dashboard security migration')

const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')
assert.match(
  sql,
  /alter\s+view\s+public\.vw_kpi_dashboard\s+set\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
)
assert.match(sql, /revoke\s+all\s+on\s+public\.vw_kpi_dashboard\s+from\s+anon/i)
assert.match(sql, /grant\s+select\s+on\s+public\.vw_kpi_dashboard\s+to\s+authenticated/i)
assert.match(sql, /grant\s+select\s+on\s+public\.vw_kpi_dashboard\s+to\s+service_role/i)
assert.doesNotMatch(sql, /\b(?:insert|update|delete|truncate)\b/i)
assert.doesNotMatch(sql, /\b(?:drop|create)\s+(?:table|view)\b/i)

console.log(`KPI dashboard security migration: ok (${names[0]})`)
