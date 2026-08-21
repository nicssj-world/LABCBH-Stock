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

/**
 * Shown on a requisition line whose item has run out since the requisition was
 * saved. The picker only offers items with stock, so this can only appear while
 * editing — and it has to say so plainly, not just turn the number red.
 */
export const OUT_OF_STOCK_WARNING = 'ของหมดคลัง คงเหลือ 0 เจ้าหน้าที่คลังจ่ายรายการนี้ไม่ได้'
