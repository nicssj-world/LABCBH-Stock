import { bangkokIsoDate } from '@/lib/date/thai'
import type { ServiceFulfillmentStatus } from './schema'

export const SERVICE_PLAN_EXPENSE_ENTRY_KINDS = [
  'expense',
  'historical_expense',
  'expense_adjustment',
  'expense_reversal',
] as const

const SERVICE_PLAN_MONTH_COUNT = 12

export interface ServicePlanMonthlySeriesEntry {
  month: string
  amount: number
}

export function fiscalYearFromDate(value: string | Date): number {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10)
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  return year + (month >= 10 ? 544 : 543)
}

export function fiscalYearRange(fiscalYear: number): { start: string; end: string } {
  const startGregorianYear = fiscalYear - 544
  return {
    start: `${startGregorianYear}-10-01`,
    end: `${startGregorianYear + 1}-09-30`,
  }
}

export function isDateInFiscalYear(value: string, fiscalYear: number): boolean {
  const range = fiscalYearRange(fiscalYear)
  return value >= range.start && value <= range.end
}

function monthKey(value: string): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(value.slice(0, 10))
  if (!match) return null
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}-01` : null
}

function monthAfter(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

function monthSequence(start: string, end: string): string[] {
  const months: string[] = []
  for (let cursor = start; cursor <= end; cursor = monthAfter(cursor)) months.push(cursor)
  return months
}

export function isServicePlanExpenseKind(value: string): boolean {
  return (SERVICE_PLAN_EXPENSE_ENTRY_KINDS as readonly string[]).includes(value)
}

/** Returns every month in the plan period through the current month. */
export function servicePlanMonthlySeries(
  fiscalYear: number,
  entries: ReadonlyArray<{ eventDate: string; entryKind: string; amount: number }>,
  now: Date = new Date(),
): ServicePlanMonthlySeriesEntry[] {
  const range = fiscalYearRange(fiscalYear)
  const firstMonth = monthKey(range.start)!
  const finalMonth = monthKey(range.end)!
  const currentMonth = monthKey(bangkokIsoDate(now))!
  const lastMonth = currentMonth < firstMonth
    ? firstMonth
    : currentMonth > finalMonth
      ? finalMonth
      : currentMonth
  const totals = new Map<string, number>()

  for (const entry of entries) {
    if (!isServicePlanExpenseKind(entry.entryKind)) continue
    const month = monthKey(entry.eventDate)
    if (!month || month < firstMonth || month > lastMonth) continue
    const cents = Math.round(entry.amount * 100)
    totals.set(month, (totals.get(month) ?? 0) + cents)
  }

  return monthSequence(firstMonth, lastMonth).map((month) => ({
    month,
    // A full reversal can make a month's net negative. It is not a negative
    // spend bar, so keep the visual series non-negative while the ledger keeps
    // the signed source amounts intact.
    amount: Math.max(0, totals.get(month) ?? 0) / 100,
  }))
}

/** Manual plan expenses are spread across the fixed twelve-month fiscal year. */
export function servicePlanAverageMonthly(spent: number): number {
  return Math.round((Math.max(0, spent) / SERVICE_PLAN_MONTH_COUNT) * 100) / 100
}

/** Manual entries can target the current month or any earlier month in the plan. */
export function servicePlanExpenseMonthOptions(fiscalYear: number, now: Date = new Date()): string[] {
  const range = fiscalYearRange(fiscalYear)
  const firstMonth = monthKey(range.start)!
  const finalMonth = monthKey(range.end)!
  const currentMonth = monthKey(bangkokIsoDate(now))!
  const lastMonth = currentMonth < firstMonth
    ? null
    : currentMonth > finalMonth
      ? finalMonth
      : currentMonth

  return lastMonth ? monthSequence(firstMonth, lastMonth).map((month) => month.slice(0, 7)) : []
}

export function formatServiceRequestNumber(fiscalYear: number, sequence: number): string {
  return `SPR-${fiscalYear}-${String(sequence).padStart(4, '0')}`
}

export function calculateAnnualRequestTotal(
  items: readonly { requestedQuantity: number; unitPrice: number }[],
): number {
  return Math.round(items.reduce((sum, item) => sum + item.requestedQuantity * item.unitPrice, 0) * 100) / 100
}

export function planBalance(input: { budget: number; spent: number; reserved: number }) {
  return {
    ...input,
    available: Math.round((input.budget - input.spent - input.reserved) * 100) / 100,
  }
}

export function deriveServiceFulfillment(requestedQuantity: number, usedQuantity: number): ServiceFulfillmentStatus {
  if (usedQuantity <= 0) return 'not_started'
  if (usedQuantity >= requestedQuantity) return 'complete'
  return 'partial'
}

export function isLabExpenseWithinRequest(amount: number, requestedAmount: number, alreadyUsed: number): boolean {
  return amount > 0 && amount + alreadyUsed <= requestedAmount
}
