import { bangkokIsoDate } from '@/lib/date/thai'
import type { ServiceFulfillmentStatus, ServiceExpenseFrequency, ServicePrStatus, ServicePoStatus } from './schema'
import type { ServicePurchaseRequestRecord, ServiceUsageEventRecord } from './types'

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

export const SERVICE_REQUEST_DISPLAY_STATUSES = [
  'pending_confirmation',
  'awaiting_po',
  'po_incomplete',
  'ready_for_expense',
  'recording_expense',
  'closed',
  'cancelled',
] as const

export type ServiceRequestDisplayStatus = (typeof SERVICE_REQUEST_DISPLAY_STATUSES)[number]

/** Terminal rows stay out of the default register view until the user asks for them. */
export const SERVICE_REQUEST_TERMINAL_STATUSES: readonly ServiceRequestDisplayStatus[] = ['closed', 'cancelled']

export function isServiceRequestTerminalStatus(value: ServiceRequestDisplayStatus): boolean {
  return (SERVICE_REQUEST_TERMINAL_STATUSES as readonly string[]).includes(value)
}

/** The concise status groups shown in the register filter. */
export const SERVICE_REQUEST_FILTER_STATUSES: readonly ServiceRequestDisplayStatus[] = [
  'pending_confirmation',
  'awaiting_po',
  'ready_for_expense',
  'recording_expense',
  'closed',
  'cancelled',
]

export interface ServiceRequestStatusInput {
  status: ServicePrStatus
  poStatus: ServicePoStatus
  poNumber: string | null
  poFileName: string | null
  activeExpenseCount: number
}

/** Derives one user-facing workflow state from the two persisted state axes. */
export function deriveServiceRequestDisplayStatus(input: ServiceRequestStatusInput): ServiceRequestDisplayStatus {
  if (input.status === 'cancelled' || input.poStatus === 'cancelled') return 'cancelled'
  if (input.status === 'closed' || input.poStatus === 'closed') return 'closed'
  if (input.status === 'pending') return 'pending_confirmation'
  const hasNumber = Boolean(input.poNumber?.trim())
  const hasFile = Boolean(input.poFileName?.trim())
  if (!hasNumber && !hasFile) return 'awaiting_po'
  if (!hasNumber || !hasFile) return 'po_incomplete'
  return input.activeExpenseCount > 0 ? 'recording_expense' : 'ready_for_expense'
}

export function serviceRequestDisplayStatus(request: Pick<ServicePurchaseRequestRecord, 'status' | 'poStatus' | 'poNumber' | 'poFileName' | 'usageEvents'>): ServiceRequestDisplayStatus {
  return deriveServiceRequestDisplayStatus({
    status: request.status,
    poStatus: request.poStatus,
    poNumber: request.poNumber,
    poFileName: request.poFileName,
    activeExpenseCount: request.usageEvents.filter((event) => event.kind === 'lab_expense' && event.status === 'active').length,
  })
}

export function isServiceRequestDisplayStatus(value: string | undefined): value is ServiceRequestDisplayStatus {
  return value !== undefined && (SERVICE_REQUEST_DISPLAY_STATUSES as readonly string[]).includes(value)
}

export function serviceRequestMatchesDisplayStatus(
  request: Pick<ServicePurchaseRequestRecord, 'status' | 'poStatus' | 'poNumber' | 'poFileName' | 'usageEvents'>,
  status: ServiceRequestDisplayStatus | undefined,
): boolean {
  if (status === undefined) return true
  const displayStatus = serviceRequestDisplayStatus(request)
  // A PO with only one piece of evidence is still waiting for PO data from
  // the user's point of view. Keep the precise internal state for badges and
  // audits, but group it with awaiting_po in the register filter.
  if (status === 'awaiting_po') return displayStatus === 'awaiting_po' || displayStatus === 'po_incomplete'
  return displayStatus === status
}

export function serviceExpenseFrequency(isRedCross: boolean): ServiceExpenseFrequency {
  return isRedCross ? 'daily' : 'monthly'
}

export function serviceUsageEventSignedAmount(event: Pick<ServiceUsageEventRecord, 'kind' | 'status' | 'amount' | 'documentType'>): number {
  if (event.status !== 'active') return 0
  if (event.kind === 'lab_expense' && event.documentType === 'credit_note') return -event.amount
  return event.amount
}

export function serviceExpenseNetTotal(events: ReadonlyArray<Pick<ServiceUsageEventRecord, 'kind' | 'status' | 'amount' | 'documentType'>>): number {
  return Math.round(events
    .filter((event) => event.kind === 'lab_expense')
    .reduce((sum, event) => sum + serviceUsageEventSignedAmount(event), 0) * 100) / 100
}

export function serviceUsageNetTotal(events: ReadonlyArray<Pick<ServiceUsageEventRecord, 'kind' | 'status' | 'amount' | 'documentType'>>): number {
  return Math.round(events.reduce((sum, event) => sum + serviceUsageEventSignedAmount(event), 0) * 100) / 100
}

type ServiceExpenseDisplayEvent = Pick<ServiceUsageEventRecord, 'id' | 'kind' | 'expenseDate' | 'createdAt' | 'documentType' | 'sourceExpenseId'>

/**
 * Keeps every credit note directly below the invoice it references while
 * retaining the surrounding list's chronological direction.
 */
export function serviceExpenseEventsForDisplay<T extends ServiceExpenseDisplayEvent>(events: readonly T[], direction: 'asc' | 'desc' = 'desc'): T[] {
  const compareByDate = (left: T, right: T) => {
    const dateOrder = left.expenseDate.localeCompare(right.expenseDate)
    if (dateOrder !== 0) return direction === 'asc' ? dateOrder : -dateOrder
    const createdOrder = left.createdAt.localeCompare(right.createdAt)
    if (createdOrder !== 0) return direction === 'asc' ? createdOrder : -createdOrder
    const idOrder = left.id.localeCompare(right.id)
    return direction === 'asc' ? idOrder : -idOrder
  }
  const expenseEvents = events.filter((event) => event.kind === 'lab_expense')
  const invoices = expenseEvents.filter((event) => event.documentType === 'invoice').slice().sort(compareByDate)
  const creditNotesBySource = new Map<string, T[]>()
  const unlinkedCreditNotes: T[] = []

  for (const event of expenseEvents.filter((entry) => entry.documentType === 'credit_note')) {
    if (!event.sourceExpenseId) {
      unlinkedCreditNotes.push(event)
      continue
    }
    const rows = creditNotesBySource.get(event.sourceExpenseId) ?? []
    rows.push(event)
    creditNotesBySource.set(event.sourceExpenseId, rows)
  }

  return invoices.flatMap((invoice) => [
    invoice,
    ...(creditNotesBySource.get(invoice.id) ?? []).slice().sort(compareByDate),
  ]).concat(unlinkedCreditNotes.slice().sort(compareByDate))
}

export interface ServiceCreditNoteSourceOption {
  id: string
  invoiceNumber: string | null
  originalAmount: number
  creditedAmount: number
  remainingAmount: number
}

export function serviceCreditNoteSourceOptions(events: ReadonlyArray<Pick<ServiceUsageEventRecord, 'id' | 'kind' | 'status' | 'amount' | 'invoiceNumber' | 'documentType' | 'sourceExpenseId'>>): ServiceCreditNoteSourceOption[] {
  const creditedBySource = new Map<string, number>()
  for (const event of events) {
    if (event.kind !== 'lab_expense' || event.documentType !== 'credit_note' || event.status !== 'active' || !event.sourceExpenseId) continue
    creditedBySource.set(event.sourceExpenseId, (creditedBySource.get(event.sourceExpenseId) ?? 0) + event.amount)
  }

  return events
    .filter((event) => event.kind === 'lab_expense' && event.documentType === 'invoice' && event.status === 'active')
    .map((event) => {
      const originalAmount = Math.round(event.amount * 100) / 100
      const creditedAmount = Math.round((creditedBySource.get(event.id) ?? 0) * 100) / 100
      return {
        id: event.id,
        invoiceNumber: event.invoiceNumber,
        originalAmount,
        creditedAmount,
        remainingAmount: Math.max(0, Math.round((originalAmount - creditedAmount) * 100) / 100),
      }
    })
    .filter((option) => option.remainingAmount > 0)
}

export function isDateRangeWithinFiscalYear(start: string, end: string, fiscalYear: number): boolean {
  const range = fiscalYearRange(fiscalYear)
  return start < end && start >= range.start && end <= range.end
}

/**
 * Service PO usage may carry over into October immediately after the plan's
 * fiscal year ends. The request date itself remains inside the plan fiscal
 * year; only the usage window receives this one-month extension.
 */
export function servicePlanUsageDateRange(fiscalYear: number): {
  start: string
  end: string
  carryoverStart: string
  carryoverEnd: string
} {
  const fiscalRange = fiscalYearRange(fiscalYear)
  const carryoverYear = Number(fiscalRange.end.slice(0, 4))
  const carryoverStart = `${carryoverYear}-10-01`
  const carryoverEnd = `${carryoverYear}-10-31`
  return { start: fiscalRange.start, end: carryoverEnd, carryoverStart, carryoverEnd }
}

export function isDateRangeWithinServicePlanUsagePeriod(start: string, end: string, fiscalYear: number): boolean {
  const range = servicePlanUsageDateRange(fiscalYear)
  return start < end && start >= range.start && end <= range.end
}

export function isExpenseDateWithinRequest(expenseDate: string, usageStartDate: string, usageEndDate: string): boolean {
  return expenseDate >= usageStartDate && expenseDate <= usageEndDate
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
  const finalMonth = monthKey(servicePlanUsageDateRange(fiscalYear).end)!
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
  return calculateServiceRequestTotal(items)
}

/** Calculate the amount reserved by a service PR from its item quantities. */
export function calculateServiceRequestTotal(
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
