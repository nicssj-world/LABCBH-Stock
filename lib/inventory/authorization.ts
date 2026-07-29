import { canOperateStock } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'

export class InventoryAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์แก้ไขข้อมูลคลัง')
    this.name = 'InventoryAuthorizationError'
  }
}

/** Admins and stock officers operate the ledger; heads read it. */
export function assertStockOperator(actor: Actor): void {
  if (!canOperateStock(actor)) {
    throw new InventoryAuthorizationError()
  }
}
