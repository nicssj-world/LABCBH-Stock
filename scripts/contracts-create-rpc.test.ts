import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_atomic_contract_creation.sql'),
)

assert.equal(migrationNames.length, 1, 'create exactly one atomic contract RPC migration')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')

for (const functionName of ['create_contract', 'update_contract', 'archive_contract']) {
  const signature = new RegExp(`create or replace function public\\.${functionName}\\s*\\(`, 'i')
  assert.match(sql, signature)

  const functionBody = sql.match(
    new RegExp(`create or replace function public\\.${functionName}[\\s\\S]*?\\$function\\$;`, 'i'),
  )?.[0]
  assert.ok(functionBody, `${functionName} body must exist`)
  assert.match(functionBody, /security invoker/i)
  assert.match(functionBody, /set search_path = ''/i)
  assert.match(functionBody, /assert_contract_editor_actor/i)

  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${functionName}[\\s\\S]*?from ${role}`, 'i'),
    )
  }
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*?to service_role`, 'i'),
  )
}

const actorGuard = sql.match(
  /create or replace function public\.assert_contract_editor_actor[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(actorGuard, 'shared contract editor actor guard must exist')
assert.match(actorGuard, /profile\.status\s*=\s*'active'/i)
assert.match(actorGuard, /profile\.deleted_at\s+is\s+null/i)
assert.match(actorGuard, /profile\.ephis_id\s*=\s*'9495'/i)
assert.match(actorGuard, /profile\.role\s*=\s*'Manager'/i)
assert.match(actorGuard, /membership\.role\s+in\s*\('admin',\s*'head'\)/i)
assert.match(actorGuard, /membership\.active/i)

const createFunction = sql.match(
  /create or replace function public\.create_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(createFunction)
assert.match(createFunction, /jsonb_typeof\(p_contract\)\s*<>\s*'object'/i)
assert.match(createFunction, /jsonb_typeof\(p_items\)\s*<>\s*'array'/i)
assert.match(createFunction, /jsonb_array_length\(p_items\)\s*=\s*0/i)
assert.match(createFunction, /p_contract\s+\?&\s+array\s*\[[\s\S]*'fiscalYear'[\s\S]*'contractType'[\s\S]*'displayName'/i)
assert.match(createFunction, /jsonb_typeof\(item\s*->\s*'quantity'\)\s+is distinct from\s*'number'/i)
assert.match(createFunction, /jsonb_typeof\(item\s*->\s*'unitPrice'\)\s+is distinct from\s*'number'/i)
assert.match(createFunction, /unexpected contract field/i)
assert.match(createFunction, /unexpected contract item field/i)
assert.match(createFunction, /with ordinality/i)
assert.match(
  createFunction,
  /insert into public\.contracts\s*\([\s\S]*product[\s\S]*display_name[\s\S]*\) values \(\s*normalized_vendor,\s*normalized_display_name,[\s\S]*'sent_to_procurement',\s*normalized_display_name,/i,
)
assert.match(createFunction, /sum\([\s\S]*quantity[\s\S]*unitPrice/i)
assert.match(createFunction, /status[\s\S]*'pending'/i)
assert.match(createFunction, /procurement_stage[\s\S]*'sent_to_procurement'/i)
assert.match(createFunction, /contract_number[\s\S]*null/i)
assert.match(createFunction, /sent_to_procurement_date[\s\S]*p_effective_date/i)
assert.match(createFunction, /insert into public\.contract_items/i)
assert.match(createFunction, /insert into public\.contract_stage_history/i)
assert.match(createFunction, /from_stage[\s\S]*to_stage[\s\S]*values\s*\([\s\S]*null[\s\S]*'sent_to_procurement'/i)
assert.match(createFunction, /'labcbh_stock'/i)

const updateFunction = sql.match(
  /create or replace function public\.update_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(updateFunction)
assert.match(updateFunction, /for update/i)
assert.match(updateFunction, /expected updated_at/i)
assert.match(updateFunction, /unexpected contract field/i)
assert.match(updateFunction, /unexpected contract item field/i)
assert.match(updateFunction, /p_contract\s+\?&\s+array\s*\[[\s\S]*'fiscalYear'[\s\S]*'contractType'[\s\S]*'displayName'/i)
assert.match(updateFunction, /with ordinality/i)
assert.match(updateFunction, /allocation/i)
assert.match(updateFunction, /cannot remove an allocated contract item/i)
assert.match(updateFunction, /delete from public\.contract_items/i)
assert.doesNotMatch(
  updateFunction,
  /\b(?:procurement_stage|status|contract_number|start_date)\s*=/i,
  'metadata/item update RPC must not mutate workflow columns',
)

const archiveFunction = sql.match(
  /create or replace function public\.archive_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(archiveFunction)
assert.match(archiveFunction, /nullif\(btrim\(p_reason\),\s*''\)\s+is\s+null/i)
assert.match(archiveFunction, /for update/i)
assert.match(archiveFunction, /contract is already archived/i)
assert.match(archiveFunction, /is_archived\s*=\s*true/i)
assert.match(archiveFunction, /archived_by\s*=\s*p_actor_id/i)
assert.match(archiveFunction, /archive_reason\s*=\s*btrim\(p_reason\)/i)

assert.match(sql, /drop constraint if exists contracts_stage_number_check/i)
assert.match(sql, /drop constraint if exists contracts_lifecycle_status_date_check/i)
assert.match(
  compactSql,
  /source_metadata ->> 'migration' = 'lab_stock_contract_expansion'/i,
)
assert.doesNotMatch(compactSql, /grant execute[^;]+to authenticated/i)

console.log(`contracts atomic RPC schema: ok (${migrationNames[0]})`)
