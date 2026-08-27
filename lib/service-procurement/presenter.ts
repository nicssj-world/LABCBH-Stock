import { formatBaht } from '@/lib/pr/presenter'
import { SERVICE_PLAN_TYPE_LABELS, type ServicePlanType } from './schema'
import type { ServicePlanBalance, ServicePlanLedgerRecord, ServicePurchaseRequestRecord } from './types'

export { formatBaht }

export function servicePlanTypeLabel(type: ServicePlanType): string {
  return SERVICE_PLAN_TYPE_LABELS[type]
}

export function formatServiceBalance(balance: ServicePlanBalance): string {
  return `${formatBaht(balance.available)} คงเหลือ`
}

export function servicePlanLedgerKindLabel(kind: ServicePlanLedgerRecord['entryKind']): string {
  return ({
    reservation: 'สำรองวงเงิน',
    reservation_release: 'คืนยอดสำรอง',
    expense: 'ค่าใช้จ่าย',
    historical_expense: 'ค่าใช้จ่าย',
    expense_adjustment: 'ปรับยอดค่าใช้จ่าย',
    expense_reversal: 'ย้อนรายการค่าใช้จ่าย',
  })[kind]
}

export function serviceStatusLabel(status: ServicePurchaseRequestRecord['status']): string {
  return ({ pending: 'รอเจ้าหน้าที่คลังยืนยัน', confirmed: 'ยืนยันแล้ว', closed: 'ปิดแล้ว', cancelled: 'ยกเลิก' })[status]
}

export function servicePoStatusLabel(status: ServicePurchaseRequestRecord['poStatus']): string {
  return ({ not_issued: 'ยังไม่ออก PO', open: 'PO เปิด', closed: 'ปิด PO แล้ว', cancelled: 'ยกเลิก PO' })[status]
}

export function serviceMethodLabel(method: ServicePurchaseRequestRecord['purchaseMethod']): string {
  return method === 'annual_items' ? 'ซื้อในแผนทั้งปี' : 'จ้างตรวจทางห้องปฏิบัติการ'
}
