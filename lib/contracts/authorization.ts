import { canOperateStock, hasAppRole } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'

export class ContractAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์แก้ไขข้อมูลสัญญา')
    this.name = 'ContractAuthorizationError'
  }
}

export function assertContractEditor(actor: Actor): void {
  if (!hasAppRole(actor, 'admin', 'head')) {
    throw new ContractAuthorizationError()
  }
}

/** Only stock operations staff may correct the auditable procurement timeline. */
export function assertContractStageHistoryEditor(actor: Actor): void {
  if (!canOperateStock(actor)) throw new ContractAuthorizationError()
}

export class ContractExpenseAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์บันทึกค่าใช้จ่ายของสัญญานี้')
    this.name = 'ContractExpenseAuthorizationError'
  }
}

/**
 * Mirrors assert_contract_expense_actor so the UI can hide what the database
 * would refuse. The database remains the authority: it is the only place that
 * sees the contract's responsible users atomically with the write.
 *
 * The second path is not decorative. The people recording lease spending day to
 * day are Medical Technologists who hold no editor role and reach it only by
 * being named on the contract.
 */
export function canRecordContractExpense(
  actor: Actor,
  contract: { responsibleUserIds: string[] },
): boolean {
  if (hasAppRole(actor, 'admin', 'head')) return true
  return contract.responsibleUserIds.includes(actor.id)
}

export function assertContractExpenseRecorder(
  actor: Actor,
  contract: { responsibleUserIds: string[] },
): void {
  if (!canRecordContractExpense(actor, contract)) {
    throw new ContractExpenseAuthorizationError()
  }
}
