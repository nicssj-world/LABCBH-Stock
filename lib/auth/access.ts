import type { Actor, LabStockRole } from '@/lib/auth/actor'

export function hasAppRole(actor: Actor, ...roles: LabStockRole[]): boolean {
  return roles.some((role) => actor.appRoles.includes(role))
}

export function isAdministrator(actor: Actor): boolean {
  return hasAppRole(actor, 'admin')
}

export function canOperateStock(actor: Actor): boolean {
  return hasAppRole(actor, 'admin', 'stock_officer')
}
