import { canOperateStock, hasAppRole } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'
import { canRecordContractExpense } from '@/lib/contracts/authorization'

export class OutLabAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์แก้ไขข้อมูลสัญญา Out Lab')
    this.name = 'OutLabAuthorizationError'
  }
}

export function canEditOutLabContract(actor: Actor): boolean {
  return hasAppRole(actor, 'admin', 'head')
}

/** Only stock operators may originate a new Out Lab contract. */
export function canCreateOutLabContract(actor: Actor): boolean {
  return canOperateStock(actor)
}

export function assertOutLabCreator(actor: Actor): void {
  if (!canCreateOutLabContract(actor)) throw new OutLabAuthorizationError()
}

export function assertOutLabEditor(actor: Actor): void {
  if (!canEditOutLabContract(actor)) throw new OutLabAuthorizationError()
}

export class OutLabUsageAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์บันทึกยอดใช้จ่ายของสัญญานี้')
    this.name = 'OutLabUsageAuthorizationError'
  }
}

/**
 * Mirrors assert_out_lab_usage_actor so the UI can hide what the database
 * would refuse. The rule is identical to the lease one — editor, or named on
 * this contract — so it delegates rather than restating it: the shared helper
 * only reads `responsibleUserIds`, and one copy cannot drift from the other.
 *
 * The database remains the authority. It is the only place that sees the
 * contract's responsible users atomically with the write.
 */
export function canRecordOutLabUsage(
  actor: Actor,
  contract: { responsibleUserIds: string[] },
): boolean {
  return canRecordContractExpense(actor, contract)
}

export function assertOutLabUsageRecorder(
  actor: Actor,
  contract: { responsibleUserIds: string[] },
): void {
  if (!canRecordOutLabUsage(actor, contract)) throw new OutLabUsageAuthorizationError()
}
