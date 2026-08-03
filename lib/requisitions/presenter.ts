import type { RequisitionStatus } from './schema'

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  waiting: 'รอจ่าย',
  fulfilled: 'จ่ายสำเร็จ',
  cancelled: 'ยกเลิก',
}

export const REQUISITION_STATUS_TONES: Record<RequisitionStatus, 'attention' | 'success' | 'danger'> = {
  waiting: 'attention',
  fulfilled: 'success',
  cancelled: 'danger',
}
