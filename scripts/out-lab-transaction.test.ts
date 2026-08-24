import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Everything the Out Lab register must not get wrong lives in one RPC file, so
 * this asserts the shape of those guards directly against the migration text.
 *
 * Two of them are specific to this module and have no equivalent in the lease
 * flow, which is why they are worth pinning down here rather than trusting a
 * reviewer to notice their absence:
 *
 *   - recording a month is an upsert, so the ceiling sum must exclude the month
 *     being replaced;
 *   - the ceiling applies to contract_ceiling rows only, because an annual plan
 *     records testing that has already happened.
 */
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((n) => n.endsWith('_lab_stock_out_lab_rpc.sql'))
assert.equal(names.length, 1, 'exactly one Out Lab RPC migration must exist')
const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')
const compact = sql.replace(/\s+/g, ' ')

// The create link is intentionally narrower than the editor role. Keep the
// database guard aligned with the UI so a direct Server Action/RPC call cannot
// let a head create a new Out Lab contract.
const createAccessNames = readdirSync(migrationsDir).filter((n) => n.endsWith('_out_lab_create_access.sql'))
assert.equal(createAccessNames.length, 1, 'an Out Lab create-access migration must exist')
const createAccessSql = readFileSync(join(migrationsDir, createAccessNames[0]), 'utf8')
const createAccessFn = createAccessSql.slice(
  createAccessSql.search(/create or replace function public\.create_out_lab_contract/i),
)
assert.match(createAccessFn, /perform public\.assert_stock_officer_actor\(p_actor_id\)/i)
assert.doesNotMatch(createAccessFn, /perform public\.assert_contract_editor_actor\(p_actor_id\)/i)

const recordFn = compact.slice(
  compact.search(/create or replace function public\.record_out_lab_monthly_usage/i),
  compact.search(/create or replace function public\.delete_out_lab_monthly_usage/i),
)
assert.ok(recordFn.length > 0, 'record_out_lab_monthly_usage must exist')

// The contract row is locked before the committed total is computed, so two
// concurrent writers cannot both read the same remaining balance and both pass.
assert.match(
  recordFn,
  /from public\.out_lab_contracts contract where contract\.id = p_contract_id for update/i,
)
const lockAt = recordFn.search(/for update/i)
const sumAt = recordFn.search(/coalesce\(sum\(usage\.amount\), 0\)/i)
assert.ok(lockAt >= 0 && sumAt > lockAt, 'the lock must be taken before the total is summed')

// The month being written is excluded from the committed sum. Without this,
// correcting a figure downwards on a nearly-full contract would be rejected for
// exceeding a ceiling it is actually moving away from.
assert.match(recordFn, /and usage\.usage_month <> p_usage_month/i)
assert.ok(
  recordFn.search(/and usage\.usage_month <> p_usage_month/i) > sumAt,
  'the exclusion belongs to the committed-sum query',
)

// One figure per month: the write replaces rather than appends.
assert.match(
  recordFn,
  /on conflict \(out_lab_contract_id, usage_month\) do update/i,
)

// The ceiling is raised only for a contract_ceiling row. An annual plan is a
// plan: the send-out testing already happened, so refusing the write would
// leave the system holding a number that is knowingly wrong.
const ceilingGuardAt = recordFn.search(/if target_contract\.kind = 'contract_ceiling' and target_contract\.total is not null then/i)
assert.ok(ceilingGuardAt >= 0, 'the ceiling check must be scoped to contract_ceiling')
const overBudgetRaiseAt = recordFn.search(/จำนวนเงินเกินมูลค่าคงเหลือ/)
assert.ok(
  overBudgetRaiseAt > ceilingGuardAt,
  'the over-budget exception must sit inside the contract_ceiling branch',
)
assert.equal(
  (recordFn.match(/จำนวนเงินเกินมูลค่าคงเหลือ/g) ?? []).length,
  1,
  'exactly one over-budget path, so an annual plan cannot acquire one by accident',
)

// A ceiling row cannot take figures before its contract has actually started.
assert.match(recordFn, /procurement_stage is distinct from 'contract_started'/i)

const updateFn = compact.slice(
  compact.search(/create or replace function public\.update_out_lab_contract/i),
  compact.search(/create or replace function public\.advance_out_lab_contract_stage/i),
)

// Optimistic concurrency, so two editors cannot silently overwrite each other.
assert.match(updateFn, /errcode = '40001'/i)

// A row that already holds recorded months cannot switch the rule its ceiling
// is judged by; the fix for a wrong choice is to archive and re-register.
assert.match(updateFn, /ไม่สามารถเปลี่ยนประเภทสัญญาได้/)

// Lowering a contract value below what is already recorded would produce a
// negative balance nobody could explain. An annual plan may legitimately be
// revised below its spend — that is what "เกินแผน" means — so the guard is
// scoped the same way the write-time ceiling is.
assert.match(updateFn, /if current_contract\.kind = 'contract_ceiling' and parsed_total is not null and committed > parsed_total then/i)

// Narrowing the period must not strand a month that already holds a figure.
assert.match(updateFn, /ช่วงเวลาใหม่ไม่ครอบคลุมเดือนที่บันทึกยอดไว้แล้ว/)

const advanceFn = compact.slice(
  compact.search(/create or replace function public\.advance_out_lab_contract_stage/i),
  compact.search(/create or replace function public\.record_out_lab_monthly_usage/i),
)

// An annual plan is a budget line, not something procured through this
// register. The table CHECK makes the state unreachable; this is the guard that
// produces a message a person can act on.
assert.match(advanceFn, /if current_contract\.kind <> 'contract_ceiling' then/i)
assert.match(advanceFn, /สัญญางบตามแผนไม่มีขั้นตอนจัดซื้อ/)

// Being named on a contract is a way to record against that contract only.
assert.match(sql, /create or replace function public\.assert_out_lab_usage_actor/i)
assert.match(compact, /p_actor_id = any \(coalesce\(contract\.responsible_user_ids, '\{\}'::uuid\[\]\)\)/i)
assert.match(compact, /perform public\.assert_contract_editor_actor\(p_actor_id\)/i)

// Ending or un-filing a record is an administrator's decision, not an editor's.
for (const fn of ['archive_out_lab_contract', 'restore_out_lab_contract', 'expire_out_lab_contract']) {
  const body = compact.slice(compact.search(new RegExp(`create or replace function public\\.${fn}`, 'i')))
  assert.match(
    body.slice(0, 900),
    /perform public\.assert_lab_stock_admin_actor\(p_actor_id\)/i,
    `${fn} must be admin-only`,
  )
}

// Every function is invoker-rights and pinned to an empty search_path.
assert.doesNotMatch(sql, /security definer/i)
assert.equal(
  (sql.match(/security invoker/g) ?? []).length,
  (sql.match(/set search_path = ''/g) ?? []).length,
  'every function must pin its search_path',
)

// Only the service role may execute these; the browser never calls them.
for (const fn of [
  'assert_out_lab_usage_actor',
  'create_out_lab_contract',
  'update_out_lab_contract',
  'advance_out_lab_contract_stage',
  'record_out_lab_monthly_usage',
  'delete_out_lab_monthly_usage',
  'set_out_lab_responsible_users',
  'set_out_lab_contract_file',
  'archive_out_lab_contract',
  'restore_out_lab_contract',
  'expire_out_lab_contract',
]) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.${fn}[^;]*from public, anon, authenticated`, 'i'),
    `${fn} must be revoked from authenticated`,
  )
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${fn}[^;]*to service_role`, 'i'),
    `${fn} must be granted to service_role`,
  )
}

// The portal's financial history stays out of reach from the write path too.
const statements = sql.replace(/--[^\r\n]*/g, ' ').replace(/\s+/g, ' ')
assert.doesNotMatch(statements, /public\.contract_usage/i)
assert.doesNotMatch(statements, /(insert into|update|delete from) public\.contracts\b/i)

console.log('out lab transaction tests passed')
