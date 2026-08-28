import { hasAppRole } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'

export class ServiceProcurementAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceProcurementAuthorizationError'
  }
}

export function canManageServicePlans(actor: Actor): boolean {
  return hasAppRole(actor, 'admin', 'stock_officer')
}

export function canCreateServicePurchaseRequest(actor: Actor): boolean {
  return hasAppRole(actor, 'admin', 'head')
}

export function canOperateServicePurchaseRequest(actor: Actor): boolean {
  return hasAppRole(actor, 'admin', 'stock_officer')
}

export function canRecordServicePlanExpense(actor: Actor, responsibleProfileIds: readonly string[], requesterId: string | null = null): boolean {
  return hasAppRole(actor, 'admin') || actor.id === requesterId || responsibleProfileIds.includes(actor.id)
}

/** Closing a service PO belongs to the requester/expense recorder, not stock-only operators. */
export function canCloseServicePurchaseRequest(actor: Actor, requesterId: string | null, responsibleProfileIds: readonly string[]): boolean {
  return hasAppRole(actor, 'admin') || actor.id === requesterId || responsibleProfileIds.includes(actor.id)
}

export function canCancelServicePurchaseRequestPo(actor: Actor, requesterId: string | null): boolean {
  return hasAppRole(actor, 'admin') || actor.id === requesterId
}

export function assertServicePlanManager(actor: Actor): void {
  if (!canManageServicePlans(actor)) throw new ServiceProcurementAuthorizationError('ไม่มีสิทธิ์จัดการแผนงานจ้าง')
}

export function assertServiceRequester(actor: Actor): void {
  if (!canCreateServicePurchaseRequest(actor)) throw new ServiceProcurementAuthorizationError('ไม่มีสิทธิ์สร้างใบ PR งานจ้าง')
}

export function assertServiceStockOperator(actor: Actor): void {
  if (!canOperateServicePurchaseRequest(actor)) throw new ServiceProcurementAuthorizationError('ไม่มีสิทธิ์ดำเนินการ PO งานจ้าง')
}
