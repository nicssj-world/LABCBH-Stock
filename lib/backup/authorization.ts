import type { Actor } from '@/lib/auth/actor'
import { canManageMemberships } from '@/lib/access/authorization'

export class BackupAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์จัดการการสำรองฐานข้อมูล')
    this.name = 'BackupAuthorizationError'
  }
}

export function canManageBackups(actor: Actor): boolean {
  return canManageMemberships(actor)
}

export function assertBackupManager(actor: Actor): void {
  if (!canManageBackups(actor)) throw new BackupAuthorizationError()
}
