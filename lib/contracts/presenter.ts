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
  contractNumberLabel: string
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
    contractStatusLabel: effectiveStatus
      ? CONTRACT_STATUS_LABELS[effectiveStatus]
      : 'ไม่ระบุสถานะ',
    contractNumberLabel: contract.contractNumber?.trim() || 'ยังไม่มีเลขที่สัญญา',
  }
}
