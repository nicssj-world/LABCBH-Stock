/**
 * Thai fiscal-year arithmetic for the Out Lab register, and the "which period
 * did nobody fill in?" check that drives its reminder chips.
 *
 * Pure by design: `actions.ts` is a 'use server' module and may only export
 * async functions, so these live in their own file the way `files.ts` sits
 * beside `file-actions.ts`.
 */

/** ต.ค. is already the next fiscal year, which is the off-by-one that matters. */
const FISCAL_YEAR_FIRST_MONTH = 10

export type OutLabCadence = 'monthly' | 'quarterly' | 'as_needed'

export interface FiscalYearBounds {
  startDate: string
  endDate: string
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}-01`
}

/**
 * Thai fiscal year 2569 runs 1 Oct 2025 - 30 Sep 2026. CE = BE - 543, and the
 * year opens in the *previous* calendar year, hence the extra -1.
 */
export function fiscalYearBounds(fiscalYear: number): FiscalYearBounds {
  const endYear = fiscalYear - 543
  return {
    startDate: `${endYear - 1}-10-01`,
    endDate: `${endYear}-09-30`,
  }
}

/** Accepts `YYYY-MM` or any `YYYY-MM-DD`. Returns the Thai fiscal year (BE). */
export function fiscalYearOfMonth(value: string): number | null {
  const parsed = parseMonth(value)
  if (!parsed) return null
  const [year, month] = parsed
  return month >= FISCAL_YEAR_FIRST_MONTH ? year + 544 : year + 543
}

/** 1 = ต.ค.-ธ.ค., 2 = ม.ค.-มี.ค., 3 = เม.ย.-มิ.ย., 4 = ก.ค.-ก.ย. */
export function fiscalQuarterOfMonth(value: string): number | null {
  const parsed = parseMonth(value)
  if (!parsed) return null
  const [, month] = parsed
  return Math.floor(((month - FISCAL_YEAR_FIRST_MONTH + 12) % 12) / 3) + 1
}

function parseMonth(value: string): [number, number] | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value.trim())
  if (!match) return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return [Number(match[1]), month]
}

function shiftMonth(month: string, offset: number): string {
  const parsed = parseMonth(month)
  if (!parsed) return month
  const cursor = new Date(Date.UTC(parsed[0], parsed[1] - 1 + offset, 1))
  return monthKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1)
}

function monthsBetween(firstMonth: string, lastMonth: string): string[] {
  const months: string[] = []
  let cursor = firstMonth
  while (cursor <= lastMonth) {
    months.push(cursor)
    cursor = shiftMonth(cursor, 1)
  }
  return months
}

export type MissingUsagePeriod =
  | { period: 'month'; month: string }
  | { period: 'quarter'; fiscalYear: number; quarter: number; startMonth: string; endMonth: string }

export interface MissingUsagePeriodsInput {
  cadence: OutLabCadence
  startDate: string | null
  endDate: string | null
  entries: Array<{ usageMonth: string | null }>
}

/**
 * Periods that have fully elapsed and still hold no figure.
 *
 * The current month is deliberately excluded: a month is billed after it
 * closes, which is why the entry form also defaults to the previous month.
 * Flagging a month nobody could reasonably have filled in yet would train
 * people to ignore the chip.
 */
export function missingUsagePeriods(
  { cadence, startDate, endDate, entries }: MissingUsagePeriodsInput,
  now: Date = new Date(),
): MissingUsagePeriod[] {
  // "When there is usage" has no schedule, so nothing can be late.
  if (cadence === 'as_needed') return []

  const firstMonth = startDate ? toMonth(startDate) : null
  const contractEndMonth = endDate ? toMonth(endDate) : null
  if (!firstMonth || !contractEndMonth) return []

  const bangkokNow = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const previousMonth = shiftMonth(
    monthKey(bangkokNow.getUTCFullYear(), bangkokNow.getUTCMonth() + 1),
    -1,
  )
  const lastMonth = contractEndMonth < previousMonth ? contractEndMonth : previousMonth
  if (lastMonth < firstMonth) return []

  const recorded = new Set(
    entries
      .map((entry) => (entry.usageMonth ? toMonth(entry.usageMonth) : null))
      .filter((month): month is string => month !== null),
  )
  const elapsed = monthsBetween(firstMonth, lastMonth)

  if (cadence === 'monthly') {
    return elapsed
      .filter((month) => !recorded.has(month))
      .map((month) => ({ period: 'month', month }))
  }

  // A quarterly contract is filled in once per quarter, so one month carrying a
  // figure settles the whole quarter. The quarter is only judged once its last
  // month has also elapsed, for the same reason the current month is skipped.
  const quarters = new Map<string, { fiscalYear: number; quarter: number; months: string[] }>()
  for (const month of monthsBetween(firstMonth, contractEndMonth)) {
    const fiscalYear = fiscalYearOfMonth(month)
    const quarter = fiscalQuarterOfMonth(month)
    if (fiscalYear === null || quarter === null) continue
    const key = `${fiscalYear}-${quarter}`
    const bucket = quarters.get(key) ?? { fiscalYear, quarter, months: [] }
    bucket.months.push(month)
    quarters.set(key, bucket)
  }

  const missing: Extract<MissingUsagePeriod, { period: 'quarter' }>[] = []
  for (const bucket of quarters.values()) {
    const startMonth = bucket.months[0]
    const endMonth = bucket.months[bucket.months.length - 1]
    if (endMonth > lastMonth) continue
    if (bucket.months.some((month) => recorded.has(month))) continue
    missing.push({
      period: 'quarter',
      fiscalYear: bucket.fiscalYear,
      quarter: bucket.quarter,
      startMonth,
      endMonth,
    })
  }

  return missing.sort((left, right) => left.startMonth.localeCompare(right.startMonth))
}

function toMonth(value: string): string | null {
  const parsed = parseMonth(value)
  return parsed ? monthKey(parsed[0], parsed[1]) : null
}

export interface FiscalYearUsage {
  fiscalYear: number
  used: number
}

/**
 * Per-fiscal-year subtotals. A contract-ceiling row is measured against its
 * contract value, but people still plan by fiscal year, so the detail page
 * shows this breakdown as information rather than as a second ceiling.
 */
export function usageByFiscalYear(
  entries: Array<{ usageMonth: string | null; amount: number }>,
): FiscalYearUsage[] {
  const totals = new Map<number, number>()
  for (const entry of entries) {
    if (!entry.usageMonth) continue
    const fiscalYear = fiscalYearOfMonth(entry.usageMonth)
    if (fiscalYear === null) continue
    // Satang, so a year's subtotal cannot drift away from the total shown above it.
    totals.set(fiscalYear, (totals.get(fiscalYear) ?? 0) + Math.round(entry.amount * 100))
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left - right)
    .map(([fiscalYear, used]) => ({ fiscalYear, used: used / 100 }))
}
