import assert from 'node:assert/strict'
import { decideProtectedRoute, deriveAppRoles } from '../lib/auth/access'
import type { Actor } from '../lib/auth/actor'

const baseActor: Actor = {
  id: 'profile-1',
  ephisId: '10000',
  name: 'ผู้ใช้งานทดสอบ',
  profileRole: 'Staff',
  appRoles: [],
}

assert.deepEqual(
  deriveAppRoles({ ephisId: '9495', profileRole: 'Staff', profileStatus: 'active', deletedAt: null, memberships: [] }),
  ['admin'],
  'E-Phis 9495 must retain administrator access',
)

assert.deepEqual(
  deriveAppRoles({ ephisId: '10000', profileRole: 'Manager', profileStatus: 'active', deletedAt: null, memberships: [] }),
  ['head'],
  'the shared Manager profile role must derive LAB Stock head access',
)

assert.deepEqual(
  deriveAppRoles({
    ephisId: '10000',
    profileRole: 'Staff',
    profileStatus: 'active',
    deletedAt: null,
    memberships: [
      { role: 'stock_officer', active: true },
      { role: 'viewer', active: false },
      { role: 'stock_officer', active: true },
    ],
  }),
  ['stock_officer'],
  'only active LAB Stock memberships must grant access and roles must be unique',
)

for (const source of [
  { ephisId: '9495', profileRole: 'Admin', profileStatus: 'inactive', deletedAt: null },
  { ephisId: '9495', profileRole: 'Admin', profileStatus: 'active', deletedAt: '2026-07-29T00:00:00Z' },
  { ephisId: '10000', profileRole: 'Manager', profileStatus: 'inactive', deletedAt: null },
]) {
  assert.deepEqual(
    deriveAppRoles({ ...source, memberships: [{ role: 'admin', active: true }] }),
    [],
    'inactive or soft-deleted profiles must not derive intrinsic or membership access',
  )
}

assert.equal(decideProtectedRoute(null), 'login')
assert.equal(decideProtectedRoute(baseActor), 'access-denied')

for (const role of ['admin', 'head', 'stock_officer', 'viewer', 'reporter'] as const) {
  assert.equal(
    decideProtectedRoute({ ...baseActor, appRoles: [role] }),
    'allow',
    `${role} must be allowed into protected LAB Stock routes`,
  )
}

console.log('auth access behavior: ok')
