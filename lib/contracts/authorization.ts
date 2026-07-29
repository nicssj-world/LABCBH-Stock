import { hasAppRole } from '@/lib/auth/access'
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
