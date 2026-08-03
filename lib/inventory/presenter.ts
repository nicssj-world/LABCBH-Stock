import type { LotExpiryStatus, MovementType, StockLevel } from './balance'

export const STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  depleted: 'หมดคลัง',
  below_minimum: 'ต่ำกว่าขั้นต่ำ',
  healthy: 'เพียงพอ',
}

export const STOCK_LEVEL_TONES: Record<StockLevel, 'danger' | 'attention' | 'success'> = {
  depleted: 'danger',
  below_minimum: 'attention',
  healthy: 'success',
}

export const LOT_EXPIRY_LABELS: Record<LotExpiryStatus, string> = {
  expired: 'หมดอายุแล้ว',
  near_expiry: 'ใกล้หมดอายุ',
  usable: 'ใช้งานได้',
}

export const LOT_EXPIRY_TONES: Record<LotExpiryStatus, 'danger' | 'attention' | 'success'> = {
  expired: 'danger',
  near_expiry: 'attention',
  usable: 'success',
}

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  goods_receipt: 'รับเข้า',
  requisition_issue: 'เบิกจ่าย',
  opening_adjustment: 'ยอดยกมา',
  manual_adjustment: 'ปรับยอด',
  reversal: 'กลับรายการ',
}

const quantityFormatter = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 })

export function formatQuantity(value: number, unit?: string | null): string {
  const formatted = quantityFormatter.format(value)
  return unit ? `${formatted} ${unit}` : formatted
}

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
})

export function formatBaht(value: number | null): string {
  return value === null ? 'ไม่ระบุ' : money.format(value)
}

export function formatThaiDate(isoDate: string | null): string {
  if (!isoDate) return 'ไม่ระบุ'
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
}

/** For a full `timestamptz` value (who/when an action happened), not a plain date. */
export function formatThaiDateTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) return 'ไม่ระบุ'
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(isoTimestamp))
}
