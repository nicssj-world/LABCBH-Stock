import type { BudgetSnapshot } from '@/lib/contracts/budget'
import { PROCUREMENT_STAGE_LABELS, contractExpiryNotice, effectiveContractStatus } from '@/lib/contracts/presenter'
import type { ContractExpiryNotice } from '@/lib/contracts/presenter'
import type { MissingUsagePeriod } from '@/lib/out-lab/fiscal'
import type {
  OutLabCadence,
  OutLabContractRecord,
  OutLabKind,
  OutLabStatus,
} from '@/lib/out-lab/types'

/** Every row in this register is one contract type; only its budget shape varies. */
export const OUT_LAB_CONTRACT_TYPE_LABEL = 'จ้างตรวจทางห้องปฏิบัติการ'

export const OUT_LAB_KIND_LABELS: Record<OutLabKind, string> = {
  contract_ceiling: 'ตามมูลค่าสัญญา',
  annual_plan: 'ตามแผนรายปีงบประมาณ',
}

export const OUT_LAB_KIND_HINTS: Record<OutLabKind, string> = {
  contract_ceiling: 'มีมูลค่าสัญญาและช่วงเวลาของตัวเอง ระบบไม่ให้บันทึกเกินมูลค่าสัญญา',
  annual_plan: 'ใช้งบตามแผนของปีงบประมาณ ตั้งใหม่ทุกปี บันทึกเกินแผนได้แต่จะขึ้นคำเตือน',
}

export const OUT_LAB_CADENCE_LABELS: Record<OutLabCadence, string> = {
  monthly: 'ทุกเดือน',
  quarterly: 'ทุก 3 เดือน',
  as_needed: 'เมื่อมีการใช้',
}

export const OUT_LAB_STATUS_LABELS: Record<OutLabStatus, string> = {
  pending: 'อยู่ระหว่างดำเนินการ',
  active: 'ใช้งานอยู่',
  expired: 'สิ้นสุดสัญญา',
  cancelled: 'ยกเลิก',
}

const FISCAL_QUARTER_LABELS = ['ต.ค.–ธ.ค.', 'ม.ค.–มี.ค.', 'เม.ย.–มิ.ย.', 'ก.ค.–ก.ย.']

const thaiMonth = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  year: 'numeric',
  month: 'long',
  timeZone: 'Asia/Bangkok',
})

export function outLabMonthLabel(month: string): string {
  return thaiMonth.format(new Date(`${month}T00:00:00+07:00`))
}

export function missingPeriodLabel(period: MissingUsagePeriod): string {
  if (period.period === 'month') return outLabMonthLabel(period.month)
  return `ไตรมาส ${period.quarter} (${FISCAL_QUARTER_LABELS[period.quarter - 1]}) ปีงบ ${period.fiscalYear}`
}

export type OutLabBudgetTone = 'ok' | 'low' | 'over'

export interface OutLabBudgetNotice {
  tone: OutLabBudgetTone
  label: string
  description: string
}

/**
 * How the balance should read to the person looking at it.
 *
 * The two kinds diverge here on purpose. A contract ceiling cannot be exceeded
 * — the database refuses the write — so "over" can only ever describe an
 * annual plan, where the send-out testing has already happened and refusing to
 * record it would leave the system holding a number that is knowingly wrong.
 */
export function outLabBudgetNotice(
  kind: OutLabKind,
  snapshot: BudgetSnapshot,
): OutLabBudgetNotice | null {
  if (snapshot.percentUsed === null || snapshot.remaining === null) return null

  if (snapshot.remaining < 0) {
    return {
      tone: 'over',
      label: kind === 'annual_plan' ? 'ใช้เกินงบตามแผน' : 'ใช้เกินมูลค่าสัญญา',
      description:
        kind === 'annual_plan'
          ? 'ยอดสะสมเกินงบที่ตั้งไว้ในแผนปีงบประมาณนี้ ควรตรวจสอบและปรับแผน'
          : 'ยอดสะสมเกินมูลค่าสัญญา ควรตรวจสอบรายการที่บันทึกไว้',
    }
  }

  if (snapshot.exhausted) {
    return {
      tone: 'over',
      label: kind === 'annual_plan' ? 'ใช้ครบงบตามแผนแล้ว' : 'ใช้ครบมูลค่าสัญญาแล้ว',
      description: 'ไม่มีวงเงินคงเหลือสำหรับบันทึกเพิ่ม',
    }
  }

  if (snapshot.percentUsed > 70) {
    return {
      tone: 'low',
      label: 'คงเหลือต่ำกว่า 30%',
      description: kind === 'annual_plan' ? 'ควรทบทวนแผนของปีงบประมาณนี้' : 'ควรเตรียมต่อสัญญาหรือจัดหาใหม่',
    }
  }

  return { tone: 'ok', label: 'งบคงเหลือเพียงพอ', description: 'ยังบันทึกยอดได้ตามปกติ' }
}

export interface PresentedOutLabContract extends OutLabContractRecord {
  kindLabel: string
  cadenceLabel: string
  statusLabel: string
  procurementStageLabel: string | null
  effectiveStatus: OutLabStatus | null
  expiryNotice: ContractExpiryNotice | null
  fiscalYearLabel: string
  contractNumberLabel: string
  vendorLabel: string
  departmentLabel: string
}

export function presentOutLabContract(
  contract: OutLabContractRecord,
  now: Date = new Date(),
): PresentedOutLabContract {
  // The end date is inclusive, so the shared helper decides when a row stops
  // reading as active — same rule as the contract register.
  const effectiveStatus = effectiveContractStatus(contract.status, contract.endDate, now) as OutLabStatus | null

  return {
    ...contract,
    kindLabel: OUT_LAB_KIND_LABELS[contract.kind],
    cadenceLabel: OUT_LAB_CADENCE_LABELS[contract.entryCadence],
    statusLabel: OUT_LAB_STATUS_LABELS[effectiveStatus ?? contract.status],
    procurementStageLabel: contract.procurementStage
      ? PROCUREMENT_STAGE_LABELS[contract.procurementStage]
      : null,
    effectiveStatus,
    expiryNotice: contractExpiryNotice(contract.status, contract.endDate, now),
    fiscalYearLabel: `ปีงบ ${contract.fiscalYear}`,
    contractNumberLabel: contract.contractNumber ?? 'ยังไม่มีเลขที่สัญญา',
    vendorLabel: contract.vendor ?? 'ไม่ระบุ',
    departmentLabel: contract.department ?? 'ไม่ระบุ',
  }
}
