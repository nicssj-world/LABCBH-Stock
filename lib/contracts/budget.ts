import type { ContractType } from '@/lib/contracts/types'

export type ContractMode = 'budget' | 'supply'

// Equipment leases are billed as a monthly baht draw against a ceiling. Every
// other contract type delivers goods and is tracked by line item instead.
export function contractMode(contractType: ContractType): ContractMode {
  return contractType === 'equipment_lease' ? 'budget' : 'supply'
}

export function normalizeUsageMonth(value: string): string | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value.trim())
  if (!match) return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return `${match[1]}-${match[2]}-01`
}

function satang(value: number): number {
  return Math.round(value * 100)
}

export interface BudgetSnapshotInput {
  total: number | null
  entries: { amount: number }[]
}

export interface BudgetSnapshot {
  used: number
  remaining: number | null
  percentUsed: number | null
  exhausted: boolean
}

export function budgetSnapshot({ total, entries }: BudgetSnapshotInput): BudgetSnapshot {
  const usedSatang = entries.reduce((sum, entry) => sum + satang(entry.amount), 0)
  const used = usedSatang / 100

  // A contract without a total has an unknown ceiling, not a zero one. Callers
  // must render that as unknown rather than as fully consumed.
  if (total === null || total === 0) {
    return { used, remaining: null, percentUsed: null, exhausted: false }
  }

  const totalSatang = satang(total)
  const remainingSatang = totalSatang - usedSatang
  return {
    used,
    remaining: remainingSatang / 100,
    percentUsed: (usedSatang / totalSatang) * 100,
    exhausted: remainingSatang <= 0,
  }
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30

export function monthsLeft(endDate: string | null, now: Date = new Date()): number {
  if (!endDate) return 999
  return Math.floor((new Date(endDate).getTime() - now.getTime()) / MS_PER_MONTH)
}

// A larger contract needs more lead time to re-tender, so it warns earlier.
export function isExpiring(
  total: number | null,
  endDate: string | null,
  now: Date = new Date(),
): boolean {
  if (!endDate) return false
  const left = monthsLeft(endDate, now)
  return (total ?? 0) > 10_000_000 ? left <= 6 : left <= 3
}

export function isLowBudget(total: number | null, used: number): boolean {
  if (!total) return false
  return (satang(total) - satang(used)) / satang(total) < 0.3
}

export function expenseMonthOptions(
  startDate: string | null,
  endDate: string | null,
): string[] {
  if (!startDate || !endDate) return []
  const cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`)
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`)
  const months: string[] = []
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}
