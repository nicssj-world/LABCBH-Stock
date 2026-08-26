import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260825181000_lab_stock_annual_plans.sql'),
  'utf8',
)

assert.match(migration, /create table public\.lab_stock_annual_plans/i)
assert.match(migration, /unique\s*\(fiscal_year,\s*plan_type\)/i)
assert.match(migration, /plan_type\s+text[^;]*procurement/i)
assert.match(migration, /file_mime_type\s+text[^;]*application\/pdf/i)
assert.match(migration, /file_size_bytes\s+bigint/i)
assert.match(migration, /create table public\.lab_stock_annual_plan_audit/i)
assert.match(migration, /prevent_append_only_mutation/i)
assert.match(migration, /lab-stock-annual-plans/i)
assert.match(migration, /allowed_mime_types\s*=\s*array\['application\/pdf'\]/i)
assert.match(migration, /alter table public\.lab_stock_annual_plans enable row level security/i)
assert.match(migration, /upsert_lab_stock_annual_plan/i)
assert.match(migration, /list_expired_lab_stock_annual_plans/i)
assert.match(migration, /hard_delete_lab_stock_annual_plan/i)
assert.match(migration, /previous_file_path/i)
assert.match(migration, /current_fiscal_year/i)
const planTableDefinition = migration.slice(
  migration.indexOf('create table public.lab_stock_annual_plans'),
  migration.indexOf('create index lab_stock_annual_plans_fiscal_year_idx'),
)
assert.doesNotMatch(planTableDefinition, /deleted_at/i, 'annual-plan records must hard-delete instead of soft-delete')

console.log('annual plans SQL contract: ok')
