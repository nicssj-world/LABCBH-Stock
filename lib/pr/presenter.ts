import type { PurchaseMethodKind, PurchasePurpose, PurchaseRequestStatus } from './schema'
import type { PurchaseRequestItemRecord } from './types'

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
  equipment_lease: 'เช่าเครื่อง',
}

export const PURCHASE_REQUEST_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  draft: 'ฉบับร่าง',
  pending: 'รอเจ้าหน้าที่คลังยืนยัน',
  completed: 'ยืนยันแล้ว',
  partially_received: 'รับบางส่วน',
  received: 'รับครบ',
  closed_short: 'ปิดยอดไม่ครบ',
  // Keep cancelled/reversed as separate internal lifecycle states for audit
  // and stock-allocation rules, while presenting one user-facing status.
  cancelled: 'ยกเลิก',
  reversed: 'ยกเลิก',
}

export const PURCHASE_REQUEST_STATUS_TONES: Record<
  PurchaseRequestStatus,
  'neutral' | 'info' | 'progress' | 'attention' | 'success' | 'danger'
> = {
  draft: 'neutral',
  pending: 'attention',
  completed: 'info',
  partially_received: 'progress',
  received: 'success',
  closed_short: 'attention',
  cancelled: 'danger',
  reversed: 'danger',
}

export interface PurchaseRequestReceivingSummary {
  lineCount: number
  receivedLineCount: number
  remainingLineCount: number
}

/**
 * A register can contain different units (ขวด, กล่อง, ชุด) in one PR. The
 * list therefore summarizes receiving by line, while the detail page remains
 * the source for exact quantities and units.
 */
export function summarizePurchaseRequestReceiving(
  items: readonly Pick<PurchaseRequestItemRecord, 'receivedQuantity' | 'remainingQuantity'>[],
): PurchaseRequestReceivingSummary {
  return {
    lineCount: items.length,
    receivedLineCount: items.filter((item) => item.receivedQuantity > 0).length,
    remainingLineCount: items.filter((item) => item.remainingQuantity > 0).length,
  }
}

/**
 * Shown on the PR and requisition forms. It recommends action without blocking
 * an urgent request, per the approved specification.
 */
export const MINIMUM_STOCK_WARNING = 'ยอดคงเหลือต่ำกว่าขั้นต่ำ ควรทำ PR เพิ่มเติม'

/** Matches the dashboard watchlist's own remaining/contracted < 30% threshold, so both surfaces flag the same lines. */
export const LOW_CONTRACT_BALANCE_THRESHOLD_PERCENT = 30
export const LOW_CONTRACT_BALANCE_WARNING = 'คงเหลือในสัญญาต่ำกว่า 30%'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
})

export const formatBaht = (value: number) => money.format(value)
