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

/**
 * A pending PR can be corrected by its requester, or by the roles that
 * operate the stock workflow. Heads retain create access, but cannot edit or
 * cancel another person's PR unless they are also its requester.
 */
export function canManagePurchaseRequest(actor: Actor, requesterId: string | null): boolean {
  return requesterId === actor.id || hasAppRole(actor, 'admin', 'stock_officer')
}

export function assertPurchaseRequestManager(actor: Actor, requesterId: string | null): void {
  if (!canManagePurchaseRequest(actor, requesterId)) {
    throw new PurchaseRequestAuthorizationError('ไม่มีสิทธิ์แก้ไขหรือลบใบ PR นี้')
  }
}
