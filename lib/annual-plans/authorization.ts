import { canOperateStock } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'

export class AnnualPlanAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์อัปโหลดแผนประจำปี')
    this.name = 'AnnualPlanAuthorizationError'
  }
}

export function canUploadAnnualPlan(actor: Actor) {
  return canOperateStock(actor)
}

export function assertAnnualPlanUploader(actor: Actor) {
  if (!canUploadAnnualPlan(actor)) throw new AnnualPlanAuthorizationError()
}
