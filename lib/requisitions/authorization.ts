import { hasAppRole } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'

export class RequisitionAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RequisitionAuthorizationError'
  }
}

/**
 * A waiting requisition can be corrected or withdrawn by the person who raised
 * it, or by the roles that operate the store. Heads keep create access, but a
 * head who is not the requester cannot touch someone else's requisition —
 * `requesterId` is the profile recorded at creation, never the typed-in
 * requester name, which the form lets anyone edit.
 */
export function canManageRequisition(actor: Actor, requesterId: string | null): boolean {
  return requesterId === actor.id || hasAppRole(actor, 'admin', 'stock_officer')
}

/** The same ownership boundary applies to physical receipt confirmation. */
export function canReceiveRequisition(actor: Actor, requesterId: string | null): boolean {
  return canManageRequisition(actor, requesterId)
}

export function assertRequisitionReceiver(actor: Actor, requesterId: string | null): void {
  if (!canReceiveRequisition(actor, requesterId)) {
    throw new RequisitionAuthorizationError('ไม่มีสิทธิ์ตรวจรับใบเบิกนี้')
  }
}

export function assertRequisitionManager(actor: Actor, requesterId: string | null): void {
  if (!canManageRequisition(actor, requesterId)) {
    throw new RequisitionAuthorizationError('ไม่มีสิทธิ์แก้ไขหรือยกเลิกใบเบิกนี้')
  }
}
