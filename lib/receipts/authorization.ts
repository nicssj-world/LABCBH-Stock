import { canCreateGoodsReceipt } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'

export class GoodsReceiptAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์สร้างใบรับเข้า')
    this.name = 'GoodsReceiptAuthorizationError'
  }
}

export function assertGoodsReceiptCreator(actor: Actor): void {
  if (!canCreateGoodsReceipt(actor)) {
    throw new GoodsReceiptAuthorizationError()
  }
}
