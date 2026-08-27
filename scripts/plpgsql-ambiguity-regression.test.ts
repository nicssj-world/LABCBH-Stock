import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))

// Migrations before this point are immutable production history. The audit
// scans every later function migration so the three incident patterns cannot
// be reintroduced in a new migration.
const auditFrom = '20260827044504'
const repairMigrations = new Set([
  '20260827044504_purchase_request_service_line_ambiguity.sql',
])

const dangerousPatterns = [
  {
    name: 'JSON line alias colliding with a PL/pgSQL line variable',
    pattern: /\bline\s+jsonb\s*;[\s\S]{0,12000}from\s+jsonb_array_elements(?:_text)?\([^;]*\)\s+line\s*;/i,
  },
  {
    name: 'contract_id local variable colliding with a contract column',
    pattern: /\bcontract_id\s+(?:bigint|uuid)\s*;[\s\S]{0,12000}(?:\b\w+\.contract_id\s*=\s*contract_id(?:\s|[.)])|\bwhere\s+\w+\.id\s*=\s*contract_id(?:\s|[.)]))/i,
  },
  {
    name: 'product_id local variable colliding with the chemical product column',
    pattern: /\bproduct_id\s+uuid\s*;[\s\S]{0,12000}lower\(btrim\(product\.canonical_name\)\)\s*=\s*lower\(btrim\(canonical_name\)\)/i,
  },
  {
    name: 'product_id local variable colliding in the SDS version lookup',
    pattern: /\bproduct_id\s+uuid\s*;[\s\S]{0,12000}version\.product_id\s*=\s*product_id(?:\s|[.)])/i,
  },
]

for (const file of migrationFiles) {
  if (file.slice(0, 14) < auditFrom || repairMigrations.has(file)) continue
  const sql = readFileSync(join(migrationsDir, file), 'utf8')
  for (const { name, pattern } of dangerousPatterns) {
    assert.doesNotMatch(sql, pattern, `${file}: ${name}`)
  }
}

const productionAudit = readFileSync(join(process.cwd(), 'scripts', 'plpgsql-production-audit.sql'), 'utf8')
assert.match(productionAudit, /plpgsql_check_function_tb/i)
assert.match(productionAudit, /unexpected_errors/i)
assert.match(productionAudit, /rejoin_tat/i)

console.log('PL/pgSQL ambiguity regression checks: ok')
