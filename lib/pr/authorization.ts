import { hasAppRole } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'

export class PurchaseRequestAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PurchaseRequestAuthorizationError'
  }
}

/** Heads draft and submit PRs; admins may do everything. */
export function canRequestPurchase(actor: Actor): boolean {
  return hasAppRole(actor, 'admin', 'head')
}

export function assertPurchaseRequester(actor: Actor): void {
  if (!canRequestPurchase(actor)) {
    throw new PurchaseRequestAuthorizationError('ไม่มีสิทธิ์สร้างใบ PR')
  }
}
