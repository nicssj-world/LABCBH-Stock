import type {
  ContractItemRecord,
  ContractRecord,
  ContractStatus,
  ContractType,
} from '@/lib/contracts/types'
import type { ProcurementStage } from '@/lib/contracts/stages'

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  equipment_lease: 'เช่าเครื่อง',
  e_bidding: 'E-Bidding',
  annual_specific: 'เฉพาะเจาะจงรายปี',
  specific: 'เฉพาะเจาะจง',
  off_plan: 'นอกแผน',
  awaiting_equipment_lease: 'ระหว่างรอเช่าเครื่อง',
  thai_red_cross: 'สภากาชาดไทย',
}

export const PROCUREMENT_STAGE_LABELS: Record<ProcurementStage, string> = {
  sent_to_procurement: 'ส่งพัสดุ',
  plan_published: 'ประกาศเผยแพร่แผน',
  tender_announced: 'ประกาศประกวดราคา',
  result_consideration: 'พิจารณาผล',
  winner_announced: 'ประกาศผู้ชนะ',
  contract_started: 'เริ่มสัญญา',
}

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  pending: 'อยู่ระหว่างดำเนินการ',
  active: 'ใช้งานอยู่',
  expired: 'สิ้นสุดสัญญา',
  cancelled: 'ยกเลิก',
}

export interface PresentedContract extends ContractRecord {
  resolvedDisplayName: string
  fiscalYearLabel: string
  contractTypeLabel: string
  procurementStageLabel: string
  contractStatusLabel: string
  effectiveStatus: ContractStatus | null
  expiryNotice: ContractExpiryNotice | null
  contractNumberLabel: string
}

export interface ContractExpiryNotice {
  tone: 'attention' | 'danger'
  label: string
  description: string
}

function bangkokDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

function calendarDayDifference(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function addCalendarMonths(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const targetMonth = month - 1 + count
  const targetYear = year + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function remainingDurationLabel(today: string, endDate: string): string {
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number)
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number)
  let months = (endYear - todayYear) * 12 + endMonth - todayMonth
  if (endDay < todayDay) months -= 1

  const afterMonths = addCalendarMonths(today, months)
  const days = calendarDayDifference(afterMonths, endDate)
  const parts = [months > 0 ? `${months} เดือน` : null, days > 0 ? `${days} วัน` : null].filter(Boolean)
  return parts.join(' ') || 'วันนี้'
}

/**
 * Returns a separate renewal deadline signal for active contracts. It stays
 * distinct from the lifecycle status: a contract may be active yet need
 * procurement preparation before it reaches its end date.
 */
export function contractExpiryNotice(
  status: ContractStatus | null,
  endDate: string | null,
  now: Date = new Date(),
): ContractExpiryNotice | null {
  if (status !== 'active' || !endDate) return null

  const today = bangkokDate(now)
  const daysLeft = calendarDayDifference(today, endDate)
  if (daysLeft < 0) return null

  if (daysLeft <= 30) {
    return {
      tone: 'danger',
      label: daysLeft === 0 ? 'สิ้นสุดวันนี้' : `สิ้นสุดใน ${daysLeft} วัน`,
      description: 'ควรเร่งเตรียมต่อสัญญาหรือจัดหาใหม่',
    }
  }

  if (endDate <= addCalendarMonths(today, 3)) {
    return {
      tone: 'attention',
      label: `ใกล้สิ้นสุด · เหลือ ${remainingDurationLabel(today, endDate)}`,
      description: 'ควรเตรียมต่อสัญญาหรือจัดหาใหม่',
    }
  }

  return null
}

/** The contract end date is inclusive; expiry takes effect on the following Bangkok calendar day. */
export function effectiveContractStatus(
  status: ContractStatus | null,
  endDate: string | null,
  now: Date = new Date(),
): ContractStatus | null {
  if (status !== 'active' || !endDate || endDate >= bangkokDate(now)) return status
  return 'expired'
}

/**
 * `contracts.total` is the recorded value and is therefore the source of
 * truth for the register. Newer contracts also have item rows, but the
 * legacy register intentionally has none; summing those rows would turn a
 * real contract value into zero.
 */
export function contractListValue(contract: {
  total: number | null
  items: Array<Pick<ContractItemRecord, 'lineTotal'>>
}): number | null {
  if (contract.total !== null) return contract.total
  return contract.items.reduce((sum, item) => sum + item.lineTotal, 0)
}

export function presentContract(contract: ContractRecord): PresentedContract {
  const resolvedDisplayName = contract.displayName?.trim() || contract.product
  const effectiveStatus = effectiveContractStatus(contract.status, contract.endDate)

  return {
    ...contract,
    resolvedDisplayName,
    displayName: resolvedDisplayName,
    fiscalYearLabel: contract.fiscalYear ? `ปีงบประมาณ ${contract.fiscalYear}` : 'ไม่ระบุปี',
    contractTypeLabel: contract.contractType
      ? CONTRACT_TYPE_LABELS[contract.contractType]
      : 'ไม่ระบุประเภท',
    procurementStageLabel: contract.procurementStage
      ? PROCUREMENT_STAGE_LABELS[contract.procurementStage]
      : 'ไม่ระบุขั้นตอน',
    effectiveStatus,
    expiryNotice: contractExpiryNotice(effectiveStatus, contract.endDate),
    contractStatusLabel: effectiveStatus
      ? CONTRACT_STATUS_LABELS[effectiveStatus]
      : 'ไม่ระบุสถานะ',
    contractNumberLabel: contract.contractNumber?.trim() || 'ยังไม่มีเลขที่สัญญา',
  }
}
