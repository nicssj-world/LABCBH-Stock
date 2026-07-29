import { isAdministrator } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'

export class MembershipAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์จัดการสิทธิ์ผู้ใช้งาน')
    this.name = 'MembershipAuthorizationError'
  }
}

/** Heads and stock officers run the workflow; only admins change who may. */
export function canAdministerMemberships(actor: Actor): boolean {
  return isAdministrator(actor)
}

export function assertMembershipAdministrator(actor: Actor): void {
  if (!canAdministerMemberships(actor)) {
    throw new MembershipAuthorizationError()
  }
}
