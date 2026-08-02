import type { PurchaseMethodKind, PurchasePurpose, PurchaseRequestStatus } from './schema'

export const PURCHASE_PURPOSE_LABELS: Record<PurchasePurpose, string> = {
  purchase_order: 'ทำใบ PR เพื่อสั่งซื้อ (ออก PO)',
  new_contract: 'ทำใบ PR เพื่อเริ่มสัญญาใหม่',
}

export const PURCHASE_METHOD_LABELS: Record<PurchaseMethodKind, string> = {
  annual_plan: 'ซื้อในแผนทั้งปี',
  contract: 'ซื้อในสัญญา',
  awaiting_contract: 'ซื้อเจาะจงระหว่างรอสัญญา',
  off_plan: 'ซื้อนอกแผน',
  specific_contract: 'ทำสัญญาเจาะจง',
  e_bidding: 'E-Bidding',
}

export const PURCHASE_REQUEST_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  draft: 'ฉบับร่าง',
  pending: 'รอเจ้าหน้าที่คลังยืนยัน',
  completed: 'ยืนยันแล้ว',
  cancelled: 'ยกเลิก',
  reversed: 'กลับรายการแล้ว',
}

export const PURCHASE_REQUEST_STATUS_TONES: Record<
  PurchaseRequestStatus,
  'neutral' | 'attention' | 'success' | 'danger'
> = {
  draft: 'neutral',
  pending: 'attention',
  completed: 'success',
  cancelled: 'danger',
  reversed: 'danger',
}

/**
 * Shown on the PR and requisition forms. It recommends action without blocking
 * an urgent request, per the approved specification.
 */
export const MINIMUM_STOCK_WARNING = 'ยอดคงเหลือต่ำกว่าขั้นต่ำ ควรทำ PR เพิ่มเติม'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
})

export const formatBaht = (value: number) => money.format(value)
