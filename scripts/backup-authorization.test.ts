import assert from 'node:assert/strict'
import { assertBackupManager, canManageBackups } from '../lib/backup/authorization'
import type { Actor } from '../lib/auth/actor'

const actor = (appRoles: Actor['appRoles']): Actor => ({
  id: '11111111-1111-4111-8111-111111111111',
  ephisId: '10000',
  name: 'ผู้ใช้งานทดสอบ',
  department: null,
  profileRole: 'Staff',
  appRoles,
})

for (const role of ['admin', 'stock_officer'] as const) {
  assert.equal(canManageBackups(actor([role])), true, `${role} can manage database backups`)
  assert.doesNotThrow(() => assertBackupManager(actor([role])))
}

for (const role of ['head', 'viewer'] as const) {
  assert.equal(canManageBackups(actor([role])), false, `${role} cannot manage database backups`)
  assert.throws(() => assertBackupManager(actor([role])), /ไม่มีสิทธิ์/)
}

console.log('database backup authorization: ok')
