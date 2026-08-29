import { formatBaht } from '@/lib/pr/presenter'
import { SERVICE_PLAN_TYPE_LABELS, type ServicePlanType } from './schema'
import type { ServicePlanBalance, ServicePlanLedgerRecord, ServicePurchaseRequestRecord } from './types'
import { serviceRequestDisplayStatus, type ServiceRequestDisplayStatus } from './domain'

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
  return method === 'laboratory_testing' ? 'จ้างตรวจทางห้องปฏิบัติการ' : 'จ้างตรวจทางห้องปฏิบัติการ'
}

export { serviceRequestDisplayStatus }

export function serviceRequestDisplayStatusLabel(status: ServiceRequestDisplayStatus): string {
  return ({
    pending_confirmation: 'รอคลังยืนยัน PR',
    awaiting_po: 'รอข้อมูล PO',
    po_incomplete: 'ข้อมูล PO ยังไม่ครบ',
    ready_for_expense: 'พร้อมบันทึกค่าใช้จ่าย',
    recording_expense: 'PO กำลังใช้งาน',
    closed: 'ปิด PO แล้ว',
    cancelled: 'ยกเลิก',
  })[status]
}

export function serviceRequestDisplayStatusTone(status: ServiceRequestDisplayStatus): 'neutral' | 'attention' | 'success' | 'danger' {
  if (status === 'cancelled') return 'danger'
  if (status === 'closed') return 'success'
  if (status === 'po_incomplete' || status === 'recording_expense') return 'attention'
  return 'neutral'
}
