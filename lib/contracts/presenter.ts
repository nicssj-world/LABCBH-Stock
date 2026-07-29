import type {
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
  contractNumberLabel: string
}

export function presentContract(contract: ContractRecord): PresentedContract {
  const resolvedDisplayName = contract.displayName?.trim() || contract.product

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
    contractStatusLabel: contract.status
      ? CONTRACT_STATUS_LABELS[contract.status]
      : 'ไม่ระบุสถานะ',
    contractNumberLabel: contract.contractNumber?.trim() || 'ยังไม่มีเลขที่สัญญา',
  }
}
