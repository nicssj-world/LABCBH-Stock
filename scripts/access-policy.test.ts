import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deriveAppRoles } from '../lib/auth/access'
import {
  assertMembershipAdministrator,
  assertMembershipManager,
  canAdministerMemberships,
  canChangeMembershipRole,
  canManageMemberships,
} from '../lib/access/authorization'
import { membershipInputSchema } from '../lib/access/schema'
import type { Actor } from '../lib/auth/actor'

const actor = (overrides: Partial<Actor>): Actor => ({
  id: '11111111-1111-4111-8111-111111111111',
  ephisId: '10000',
  name: 'ผู้ใช้งาน',
  department: null,
  profileRole: 'Staff',
  appRoles: [],
  ...overrides,
})

// Only administrators may change who can do what.
assert.equal(canAdministerMemberships(actor({ appRoles: ['admin'] })), true)
assert.equal(canAdministerMemberships(actor({ appRoles: ['head'] })), false)
assert.equal(canAdministerMemberships(actor({ appRoles: ['stock_officer'] })), false)
assert.equal(canAdministerMemberships(actor({ appRoles: [] })), false)
assert.equal(canManageMemberships(actor({ appRoles: ['admin'] })), true)
assert.equal(canManageMemberships(actor({ appRoles: ['stock_officer'] })), true)
assert.equal(canManageMemberships(actor({ appRoles: ['head'] })), false)
assert.equal(canChangeMembershipRole(actor({ appRoles: ['stock_officer'] }), 'head'), true)
assert.equal(canChangeMembershipRole(actor({ appRoles: ['stock_officer'] }), 'admin'), false)
assert.equal(canChangeMembershipRole(actor({ appRoles: ['admin'] }), 'admin'), true)
assert.throws(() => assertMembershipAdministrator(actor({ appRoles: ['head'] })), /ไม่มีสิทธิ์/)
assert.doesNotThrow(() => assertMembershipAdministrator(actor({ appRoles: ['admin'] })))
assert.throws(() => assertMembershipManager(actor({ appRoles: ['head'] })), /ไม่มีสิทธิ์/)
assert.doesNotThrow(() => assertMembershipManager(actor({ appRoles: ['stock_officer'] })))

assert.equal(
  membershipInputSchema.safeParse({
    profileId: '22222222-2222-4222-8222-222222222222',
    role: 'stock_officer',
    active: true,
  }).success,
  true,
)
assert.equal(
  membershipInputSchema.safeParse({
    profileId: '22222222-2222-4222-8222-222222222222',
    role: 'superuser',
    active: true,
  }).success,
  false,
  'roles outside the fixed set are rejected',
)

// Intrinsic access survives membership edits: the admin cannot lock themselves
// out, and a portal Manager keeps head access.
assert.deepEqual(
  deriveAppRoles({
    ephisId: '9495',
    profileRole: 'Staff',
    profileStatus: 'active',
    deletedAt: null,
    memberships: [],
  }),
  ['admin'],
)
assert.deepEqual(
  deriveAppRoles({
    ephisId: '10000',
    profileRole: 'Manager',
    profileStatus: 'active',
    deletedAt: null,
    memberships: [{ role: 'viewer', active: false }],
  }),
  ['head'],
)

// Deactivating a membership removes that role on the next server read, because
// roles are derived per request rather than cached in a session.
assert.deepEqual(
  deriveAppRoles({
    ephisId: '14812',
    profileRole: 'Staff',
    profileStatus: 'active',
    deletedAt: null,
    memberships: [{ role: 'stock_officer', active: true }],
  }),
  ['stock_officer'],
)
assert.deepEqual(
  deriveAppRoles({
    ephisId: '14812',
    profileRole: 'Staff',
    profileStatus: 'active',
    deletedAt: null,
    memberships: [{ role: 'stock_officer', active: false }],
  }),
  [],
)

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')

// The initial officers are seeded by the Task 2 migration, not hard-coded in
// application logic.
const accessName = readdirSync(migrationsDir).find((file) =>
  file.endsWith('_lab_stock_contracts_and_access.sql'),
)
assert.ok(accessName)
const accessSql = readFileSync(join(migrationsDir, accessName), 'utf8')
for (const ephisId of ['9495', '14812', '11050']) {
  assert.match(accessSql, new RegExp(`'${ephisId}'`))
}
assert.match(accessSql, /'stock_officer'/)

// Membership changes go through a service-role RPC that writes an audit row.
const adminName = readdirSync(migrationsDir).find((file) =>
  file.endsWith('_lab_stock_membership_admin.sql'),
)
assert.ok(adminName, 'the membership admin migration must exist')
const adminSql = readFileSync(join(migrationsDir, adminName), 'utf8')

assert.match(adminSql, /create table if not exists public\.lab_stock_membership_audit/i)
assert.match(adminSql, /alter table public\.lab_stock_membership_audit enable row level security/i)

const setFunction = adminSql.match(
  /create or replace function public\.set_lab_stock_membership[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(setFunction, 'set_lab_stock_membership must exist')
assert.match(setFunction, /security invoker/i)
assert.match(setFunction, /set search_path = ''/i)
assert.match(setFunction, /assert_lab_stock_admin_actor/i)
assert.match(setFunction, /insert into public\.lab_stock_membership_audit/i)
assert.match(setFunction, /previous_active/i)
assert.match(setFunction, /next_active/i)

// The admin check is enforced in the database, not only in the Server Action.
const adminAssert = adminSql.match(
  /create or replace function public\.assert_lab_stock_admin_actor[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(adminAssert, 'assert_lab_stock_admin_actor must exist')
assert.match(adminAssert, /ephis_id = '9495'/)
assert.match(adminAssert, /membership\.role = 'admin'/i)
assert.doesNotMatch(adminAssert, /'head'|'stock_officer'/i, 'only admins pass this gate')

const managerName = readdirSync(migrationsDir).find((file) =>
  file.endsWith('_lab_stock_membership_manager.sql'),
)
assert.ok(managerName, 'the membership manager migration must exist')
const managerSql = readFileSync(join(migrationsDir, managerName), 'utf8')
const managerAssert = managerSql.match(
  /create or replace function public\.assert_lab_stock_membership_manager[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(managerAssert, 'assert_lab_stock_membership_manager must exist')
assert.match(managerAssert, /membership\.role in \('admin',\s*'stock_officer'\)/i)
const managerSetFunction = managerSql.match(
  /create or replace function public\.set_lab_stock_membership[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(managerSetFunction, 'the forward migration must replace set_lab_stock_membership')
assert.match(managerSetFunction, /assert_lab_stock_membership_manager/i)
assert.match(managerSetFunction, /p_role\s*=\s*'admin'/i)
assert.match(managerSetFunction, /assert_lab_stock_admin_actor/i)

const recursionFixName = readdirSync(migrationsDir).find((file) =>
  file.endsWith('_lab_stock_membership_rls_recursion.sql'),
)
assert.ok(recursionFixName, 'membership RLS must include a forward-only recursion fix')
const recursionFixSql = readFileSync(join(migrationsDir, recursionFixName), 'utf8')
const adminHelper = recursionFixSql.match(
  /create or replace function public\.is_current_lab_stock_admin\(\)[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(adminHelper, 'the recursion fix must expose a current-user admin helper')
assert.match(adminHelper, /security definer/i)
assert.match(adminHelper, /set search_path = ''/i)
assert.match(adminHelper, /auth\.uid\(\)/i)
assert.match(adminHelper, /\b(?:from|join) public\.lab_stock_memberships/i)
assert.match(recursionFixSql, /revoke execute on function public\.is_current_lab_stock_admin\(\) from public/i)
assert.match(recursionFixSql, /revoke execute on function public\.is_current_lab_stock_admin\(\) from anon/i)
assert.match(recursionFixSql, /grant execute on function public\.is_current_lab_stock_admin\(\) to authenticated/i)

const membershipReadPolicy = recursionFixSql.match(
  /create policy lab_stock_memberships_self_or_admin_read[\s\S]*?;\s*(?:\r?\n|$)/i,
)?.[0]
assert.ok(membershipReadPolicy, 'the recursion fix must replace the membership read policy')
assert.match(membershipReadPolicy, /is_current_lab_stock_admin\(\)/i)
assert.doesNotMatch(
  membershipReadPolicy,
  /from public\.lab_stock_memberships/i,
  'a membership policy must not query its own RLS-protected table directly',
)

for (const fn of ['assert_lab_stock_admin_actor', 'set_lab_stock_membership']) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      adminSql,
      new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from ${role}`, 'i'),
    )
  }
  assert.match(
    adminSql,
    new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`, 'i'),
  )
}

assert.doesNotMatch(adminSql, /security definer/i)
assert.doesNotMatch(adminSql, /user_metadata|raw_user_meta_data/i)
assert.doesNotMatch(
  adminSql.replace(/\s+/g, ' '),
  /grant (?:select, )?(?:insert|update|delete)[^;]* to authenticated/i,
)

console.log('access policy: ok')
