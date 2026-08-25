import type { Actor, LabStockRole } from '@/lib/auth/actor'

interface RoleMembership {
  role: LabStockRole
  active: boolean
}

interface RoleSources {
  ephisId: string | null
  profileRole: string | null
  profileStatus: string | null
  deletedAt: string | null
  memberships: RoleMembership[]
}

export type ProtectedRouteDecision = 'allow' | 'login' | 'access-denied'

export function deriveAppRoles({
  ephisId,
  profileRole,
  profileStatus,
  deletedAt,
  memberships,
}: RoleSources): LabStockRole[] {
  if (profileStatus !== 'active' || deletedAt !== null) return []

  const roles = new Set<LabStockRole>()

  for (const membership of memberships) {
    if (membership.active) roles.add(membership.role)
  }

  if (ephisId === '9495') roles.add('admin')
  if (profileRole === 'Manager') roles.add('head')

  return [...roles]
}

export function decideProtectedRoute(actor: Actor | null): ProtectedRouteDecision {
  if (!actor) return 'login'
  return actor.appRoles.length > 0 ? 'allow' : 'access-denied'
}

export function hasAppRole(actor: Actor, ...roles: LabStockRole[]): boolean {
  return roles.some((role) => actor.appRoles.includes(role))
}

export function isAdministrator(actor: Actor): boolean {
  return hasAppRole(actor, 'admin')
}

export function canOperateStock(actor: Actor): boolean {
  return hasAppRole(actor, 'admin', 'stock_officer')
}

export function canCreateGoodsReceipt(actor: Actor): boolean {
  return hasAppRole(actor, 'admin', 'head', 'stock_officer')
}
