import type { ServiceFulfillmentStatus } from './schema'

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
