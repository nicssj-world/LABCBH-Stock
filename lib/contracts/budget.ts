import type { ContractType } from '@/lib/contracts/types'
import { roundQuantity } from '@/lib/inventory/balance'

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

export interface ContractRemainingInput {
  contractType: ContractType | null
  total: number | null
  usage: Array<{ amount: number }>
  items: Array<{
    quantity: number
    unitPrice: number
    allocations?: Array<{ quantity: number }> | null
  }>
}

export interface ContractSupplyItemBalance {
  allocatedQuantity: number
  remainingQuantity: number
  remainingValue: number
  remainingPercent: number
}

export interface ContractSupplyBalance {
  totalValue: number
  remainingValue: number
  items: ContractSupplyItemBalance[]
}

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * Calculates supply-contract balances from the allocation ledger. Quantities
 * follow the ledger's three-decimal precision and money follows satang so the
 * detail page and register cannot drift because of floating-point artifacts.
 */
export function contractSupplyBalance(
  items: ContractRemainingInput['items'],
): ContractSupplyBalance {
  const balances = items.map((item) => {
    const allocatedQuantity = roundQuantity((item.allocations ?? [])
      .reduce((sum, allocation) => sum + allocation.quantity, 0))
    const remainingQuantity = roundQuantity(Math.max(item.quantity - allocatedQuantity, 0))
    const remainingValue = satang(remainingQuantity * item.unitPrice) / 100
    const remainingPercent = item.quantity > 0
      ? clampPercentage((remainingQuantity / item.quantity) * 100)
      : 0

    return { allocatedQuantity, remainingQuantity, remainingValue, remainingPercent }
  })

  return {
    totalValue: items.reduce((sum, item) => sum + satang(item.quantity * item.unitPrice), 0) / 100,
    remainingValue: balances.reduce((sum, item) => sum + item.remainingValue, 0),
    items: balances,
  }
}

/**
 * Returns the percentage of a contract that is still available for the
 * register. Lease contracts are measured in baht; supply contracts are
 * measured from their item quantities and allocation ledger.
 */
export function contractRemainingPercent(input: ContractRemainingInput): number | null {
  if (contractMode(input.contractType ?? 'e_bidding') === 'budget') {
    const snapshot = budgetSnapshot({ total: input.total, entries: input.usage })
    return snapshot.percentUsed === null
      ? null
      : clampPercentage(100 - snapshot.percentUsed)
  }

  const balance = contractSupplyBalance(input.items)

  return balance.totalValue > 0 ? clampPercentage((balance.remainingValue / balance.totalValue) * 100) : null
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

export interface ExpenseMonthlySeriesEntry {
  month: string
  amount: number
}

/**
 * Creates a continuous monthly series for the lease detail view. A month with
 * no expense remains visible at zero, so the chart reports the contract's
 * actual elapsed period rather than only the months someone made an entry.
 */
export function expenseMonthlySeries(
  startDate: string | null,
  endDate: string | null,
  entries: Array<{ usageMonth: string | null; amount: number }>,
  now: Date = new Date(),
): ExpenseMonthlySeriesEntry[] {
  const totals = new Map<string, number>()
  for (const entry of entries) {
    if (!entry.usageMonth) continue
    const month = normalizeUsageMonth(entry.usageMonth)
    if (!month) continue
    totals.set(month, (totals.get(month) ?? 0) + satang(entry.amount))
  }

  const firstMonth = startDate ? normalizeUsageMonth(startDate) : null
  if (!firstMonth) {
    return [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, amount]) => ({ month, amount: amount / 100 }))
  }

  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const contractEndMonth = endDate ? normalizeUsageMonth(endDate) : null
  const lastMonth = contractEndMonth && contractEndMonth < currentMonth
    ? contractEndMonth
    : currentMonth
  const boundedLastMonth = lastMonth < firstMonth ? firstMonth : lastMonth
  const cursor = new Date(`${firstMonth}T00:00:00Z`)
  const end = new Date(`${boundedLastMonth}T00:00:00Z`)
  const months: ExpenseMonthlySeriesEntry[] = []

  while (cursor <= end) {
    const month = cursor.toISOString().slice(0, 10)
    months.push({ month, amount: (totals.get(month) ?? 0) / 100 })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  return months
}
