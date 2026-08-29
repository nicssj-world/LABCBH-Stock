import type { ServiceUsageEventRecord } from './types'

export const DUPLICATE_SERVICE_INVOICE_MESSAGE = 'เลข Invoice นี้ถูกใช้แล้วในใบ PR นี้ กรุณาตรวจสอบเลข Invoice'

export interface ServiceInvoiceRpcError {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

/** Matches the database unique index used for active service expense invoices. */
export function normalizeServiceInvoice(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized || null
}

export function hasDuplicateServiceInvoice(
  events: ReadonlyArray<Pick<ServiceUsageEventRecord, 'id' | 'kind' | 'status' | 'invoiceNumber'>>,
  invoiceNumber: string | null | undefined,
  excludeExpenseId?: string | null,
): boolean {
  const normalized = normalizeServiceInvoice(invoiceNumber)
  if (!normalized) return false

  return events.some((event) => (
    event.kind === 'lab_expense'
    && event.status === 'active'
    && event.id !== excludeExpenseId
    && normalizeServiceInvoice(event.invoiceNumber) === normalized
  ))
}

export function isDuplicateServiceInvoiceError(error: ServiceInvoiceRpcError | null | undefined): boolean {
  if (error?.code !== '23505') return false
  return [error.message, error.details, error.hint]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.includes('service_purchase_request_expenses_invoice_unique'))
}
