import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_inventory_global_minimum_stock_settings.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one global minimum-stock settings migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')

// A singleton table: a boolean primary key defaulting to true, with a check
// that pins it, is how this repo enforces "exactly one row" without a
// separate constraint table.
assert.match(sql, /create table if not exists public\.inventory_minimum_stock_settings/i)
assert.match(sql, /id boolean primary key default true/i)
assert.match(sql, /constraint inventory_minimum_stock_settings_singleton check \(id\)/i)
assert.match(sql, /minimum_stock_months numeric\(6,2\) not null default 1\.5 check \(minimum_stock_months > 0\)/i)
assert.match(sql, /insert into public\.inventory_minimum_stock_settings \(id, minimum_stock_months\)/i)

assert.match(sql, /alter table public\.inventory_minimum_stock_settings enable row level security/i)
assert.match(sql, /revoke all on table public\.inventory_minimum_stock_settings from public, anon, authenticated/i)
assert.match(sql, /grant select on table public\.inventory_minimum_stock_settings to authenticated/i)
assert.match(
  sql,
  /grant select, insert, update, delete on table public\.inventory_minimum_stock_settings to service_role/i,
)

// Authenticated clients stay read-only; the setting only changes through the
// service-role RPC below, matching every other inventory mutation path.
assert.doesNotMatch(compactSql, /grant (?:select, )?(?:insert|update|delete)[^;]*to authenticated/i)
assert.doesNotMatch(compactSql, /create policy [^;]+ for (?:insert|update|delete|all) to authenticated/i)
assert.match(
  sql,
  /create policy inventory_minimum_stock_settings_app_read\s+on public\.inventory_minimum_stock_settings for select\s+to authenticated/i,
)

// Every stock-app member can read the effective setting, reusing the active-
// membership predicate proven in the inventory ledger migration.
const policySql = sql.slice(sql.indexOf('create policy inventory_minimum_stock_settings_app_read'))
assert.match(policySql, /from public\.lab_stock_memberships membership/i)
assert.match(policySql, /membership_profile\.status = 'active'/i)
assert.match(policySql, /membership_profile\.deleted_at is null/i)
assert.match(policySql, /profile\.ephis_id = '9495'/i, 'the intrinsic admin identity must also read the setting')

// The RPC is the only writer, service-role only, and validates its input.
assert.match(sql, /create or replace function public\.set_inventory_minimum_stock_months\s*\(/i)
const rpc = sql.match(
  /create or replace function public\.set_inventory_minimum_stock_months[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(rpc, 'set_inventory_minimum_stock_months must exist')
assert.match(rpc, /security invoker/i)
assert.match(rpc, /set search_path = ''/i)
assert.match(rpc, /p_actor_id uuid/i)
assert.match(rpc, /p_minimum_stock_months <= 0/i, 'a zero or negative reserve must be rejected')
assert.match(rpc, /where id = true/i)
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.set_inventory_minimum_stock_months\\(uuid, numeric\\) from ${role}`, 'i'),
  )
}
assert.match(
  sql,
  /grant execute on function public\.set_inventory_minimum_stock_months\(uuid, numeric\) to service_role/i,
)

assert.doesNotMatch(sql, /security_definer/i, 'no function may escalate past the caller')
assert.doesNotMatch(sql, /drop table|drop column/i, 'this migration must be additive, not destructive')

console.log(`inventory minimum-stock settings schema: ok (${migrationNames[0]})`)
