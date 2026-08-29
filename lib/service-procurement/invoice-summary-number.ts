export interface ServiceInvoiceSummaryNumberSuggestion {
  assignedNumber: string | null
  suggestedNumber: string
  fiscalYear: number
}

/**
 * Return the canonical display form for a user-entered invoice-summary number.
 * The database remains the authority for allocation and duplicate detection;
 * this helper keeps the dialog's local validation and formatting consistent.
 */
export function normalizeInvoiceSummaryNumber(value: string, fiscalYear: number): string | null {
  const match = value.trim().match(/^([0-9]{1,6})\/([0-9]{4})$/)
  if (!match) return null

  const sequence = Number(match[1])
  const year = Number(match[2])
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999 || year !== fiscalYear) return null

  return `${String(sequence).padStart(2, '0')}/${fiscalYear}`
}
