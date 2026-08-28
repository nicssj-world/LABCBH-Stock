import { budgetSnapshot, isExpiring, isLowBudget, normalizeUsageMonth } from '@/lib/contracts/budget'
import { effectiveContractStatus } from '@/lib/contracts/presenter'
import type { ContractDurationYears, ContractStatus, ContractType } from '@/lib/contracts/types'
import { fiscalYearRange } from '@/lib/service-procurement/domain'

export const EXECUTIVE_FOLLOW_UP_CATEGORIES = [
  {
    value: 'all',
    label: 'ทุกประเด็น',
  },
  {
    value: 'receiving-data-quality',
    label: 'รับเข้าต้องตรวจสอบ',
  },
  {
    value: 'lease-usage-data-quality',
    label: 'ค่าเช่าไม่มีเดือนอ้างอิง',
  },
  {
    value: 'lease-contract-metadata',
    label: 'ข้อมูลสัญญาเช่าไม่ครบ',
  },
  {
    value: 'lease-risk',
    label: 'สัญญาเช่าที่ต้องติดตาม',
  },
  {
    value: 'pending-contracts',
    label: 'สัญญาอยู่ระหว่างดำเนินการ',
  },
] as const

export type ExecutiveFollowUpCategory = (typeof EXECUTIVE_FOLLOW_UP_CATEGORIES)[number]['value']

export type ExecutiveContractFollowUpCategory = Exclude<
  ExecutiveFollowUpCategory,
  'all' | 'receiving-data-quality'
>

export interface ExecutiveFollowUpContractLike {
  contractType: ContractType | null
  fiscalYear: number | null
  durationYears: ContractDurationYears | null
  status: ContractStatus | null
  total: number | null
  startDate: string | null
  endDate: string | null
  usages: ReadonlyArray<{ amount: number; usageMonth: string | null }>
}

const categoryValues = new Set<string>(EXECUTIVE_FOLLOW_UP_CATEGORIES.map((category) => category.value))

export function isExecutiveFollowUpCategory(value: string | undefined): value is ExecutiveFollowUpCategory {
  return value !== undefined && categoryValues.has(value)
}

const contractCategoryValues = new Set<string>([
  'lease-usage-data-quality',
  'lease-contract-metadata',
  'lease-risk',
  'pending-contracts',
])

export function isExecutiveContractFollowUpCategory(
  value: string | undefined,
): value is ExecutiveContractFollowUpCategory {
  return value !== undefined && contractCategoryValues.has(value)
}

export function executiveFollowUpCategoryLabel(category: ExecutiveFollowUpCategory): string {
  return EXECUTIVE_FOLLOW_UP_CATEGORIES.find((option) => option.value === category)?.label ?? 'ทุกประเด็น'
}

function contractOverlapsFiscalYear(contract: ExecutiveFollowUpContractLike, fiscalYear: number): boolean {
  const range = fiscalYearRange(fiscalYear)
  if (contract.startDate && contract.startDate.slice(0, 10) <= range.end) {
    if (!contract.endDate || contract.endDate.slice(0, 10) >= range.start) return true
  }
  return contract.fiscalYear === fiscalYear
}

/**
 * The contract-register drill-down uses these same predicates as the
 * executive decision queue. Keeping the predicates here prevents a button
 * from opening a broader list than the alert it came from.
 */
export function contractMatchesExecutiveFollowUp(
  contract: ExecutiveFollowUpContractLike,
  category: ExecutiveContractFollowUpCategory,
  fiscalYear: number,
): boolean {
  if (category === 'lease-usage-data-quality') {
    return contract.contractType === 'equipment_lease'
      && contract.usages.some((usage) => !normalizeUsageMonth(usage.usageMonth ?? ''))
  }

  if (category === 'lease-contract-metadata') {
    return contract.contractType === 'equipment_lease'
      && contractOverlapsFiscalYear(contract, fiscalYear)
      && (contract.durationYears === null || !contract.startDate || !contract.endDate)
  }

  if (category === 'lease-risk') {
    if (
      contract.contractType !== 'equipment_lease'
      || !contractOverlapsFiscalYear(contract, fiscalYear)
      || ['expired', 'cancelled'].includes(effectiveContractStatus(contract.status, contract.endDate) ?? '')
    ) return false

    const snapshot = budgetSnapshot({
      total: contract.total,
      entries: contract.usages.map((usage) => ({ amount: usage.amount })),
    })
    return isExpiring(contract.total, contract.endDate) || isLowBudget(contract.total, snapshot.used)
  }

  return contract.fiscalYear === fiscalYear
    && effectiveContractStatus(contract.status, contract.endDate) === 'pending'
}

/** Build a source link that opens the records behind an executive alert. */
export function executiveSourceHref(
  fiscalYear: number,
  category: ExecutiveFollowUpCategory,
): string | null {
  const params = new URLSearchParams()

  if (category === 'receiving-data-quality') {
    params.set('issue', category)
    params.set('fiscalYear', String(fiscalYear))
    return `/receipts?${params.toString()}`
  }

  if (!isExecutiveContractFollowUpCategory(category)) return null
  params.set('issue', category)
  if (category !== 'lease-usage-data-quality') params.set('followUpYear', String(fiscalYear))
  return `/contracts?${params.toString()}`
}

export function executiveFollowUpHref(
  fiscalYear: number,
  category: ExecutiveFollowUpCategory = 'all',
): string {
  const params = new URLSearchParams({ fiscalYear: String(fiscalYear) })
  if (category !== 'all') params.set('category', category)
  return `/dashboard/follow-up?${params.toString()}`
}
