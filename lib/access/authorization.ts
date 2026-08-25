import { isAdministrator } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'
import type { LabStockRoleName } from './schema'

export class MembershipAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์จัดการสิทธิ์ผู้ใช้งาน')
    this.name = 'MembershipAuthorizationError'
  }
}

/** Only administrators may change the administrator role. */
export function canAdministerMemberships(actor: Actor): boolean {
  return isAdministrator(actor)
}

/** Administrators and stock officers maintain the access matrix. */
export function canManageMemberships(actor: Actor): boolean {
  return actor.appRoles.includes('admin') || actor.appRoles.includes('stock_officer')
}

/** Stock officers can manage operational roles, but cannot grant admin. */
export function canChangeMembershipRole(actor: Actor, role: LabStockRoleName): boolean {
  return canManageMemberships(actor) && (role !== 'admin' || canAdministerMemberships(actor))
}

export function assertMembershipAdministrator(actor: Actor): void {
  if (!canAdministerMemberships(actor)) {
    throw new MembershipAuthorizationError()
  }
}

export function assertMembershipManager(actor: Actor): void {
  if (!canManageMemberships(actor)) {
    throw new MembershipAuthorizationError()
  }
}
