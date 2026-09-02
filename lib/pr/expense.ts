import { z } from 'zod'
import type { PurchaseMethodKind, PurchaseRequestStatus } from './schema'
import type { PurchaseRequestExpenseRecord } from './types'
import { isoDateSchema } from '@/lib/validation/date'

export const PURCHASE_REQUEST_EXPENSE_DOCUMENT_TYPES = ['invoice', 'credit_note'] as const
export type PurchaseRequestExpenseDocumentType = (typeof PURCHASE_REQUEST_EXPENSE_DOCUMENT_TYPES)[number]

const expenseMoneySchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => Math.round(value * 100) === value * 100, 'จำนวนเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง')

const purchaseRequestExpenseFieldsSchema = z.object({
  requestId: z.string().uuid(),
  expenseDate: isoDateSchema,
  amount: expenseMoneySchema.refine((value) => value > 0, 'ยอดค่าใช้จ่ายต้องมากกว่า 0'),
  invoiceNumber: z.string().trim().max(240, 'เลขที่เอกสารต้องไม่เกิน 240 ตัวอักษร').nullable(),
  note: z.string().trim().max(1000, 'หมายเหตุต้องไม่เกิน 1,000 ตัวอักษร').nullable(),
  documentType: z.enum(PURCHASE_REQUEST_EXPENSE_DOCUMENT_TYPES).default('invoice'),
  sourceExpenseId: z.string().uuid().nullable().default(null),
}).strict()

function refinePurchaseRequestExpenseDocument(
  value: z.infer<typeof purchaseRequestExpenseFieldsSchema>,
  context: z.RefinementCtx,
) {
  if (value.documentType === 'credit_note') {
    if (!value.sourceExpenseId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceExpenseId'], message: 'กรุณาเลือก Invoice ต้นทางของใบลดหนี้' })
    }
    if (!value.invoiceNumber) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['invoiceNumber'], message: 'กรุณาระบุเลขที่ใบลดหนี้' })
    }
  } else if (value.sourceExpenseId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceExpenseId'], message: 'Invoice ปกติไม่ต้องมี Invoice ต้นทาง' })
  }
}

export const purchaseRequestExpenseInputSchema = purchaseRequestExpenseFieldsSchema
  .superRefine(refinePurchaseRequestExpenseDocument)

export const purchaseRequestExpenseUpdateSchema = purchaseRequestExpenseFieldsSchema
  .extend({
    expenseId: z.string().uuid(),
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลการแก้ไข').max(1000, 'เหตุผลต้องไม่เกิน 1,000 ตัวอักษร'),
  })
  .strict()
  .superRefine(refinePurchaseRequestExpenseDocument)

export const purchaseRequestExpenseCancelSchema = z.object({
  requestId: z.string().uuid(),
  expenseId: z.string().uuid(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลการยกเลิก').max(1000, 'เหตุผลต้องไม่เกิน 1,000 ตัวอักษร'),
}).strict()

export type PurchaseRequestExpenseInput = z.infer<typeof purchaseRequestExpenseInputSchema>
export type PurchaseRequestExpenseUpdateInput = z.infer<typeof purchaseRequestExpenseUpdateSchema>
export type PurchaseRequestExpenseCancelInput = z.infer<typeof purchaseRequestExpenseCancelSchema>

export const DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE = 'เลข Invoice หรือเลขที่ใบลดหนี้นี้ถูกใช้แล้วในใบ PR นี้ กรุณาตรวจสอบเลขที่เอกสาร'
export const PURCHASE_CREDIT_NOTE_SOURCE_REQUIRED_MESSAGE = 'กรุณาเลือก Invoice ต้นทางของใบลดหนี้'
export const PURCHASE_CREDIT_NOTE_NUMBER_REQUIRED_MESSAGE = 'กรุณาระบุเลขที่ใบลดหนี้'
export const PURCHASE_CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE = 'ยอดใบลดหนี้เกินยอดคงเหลือของ Invoice ต้นทาง'
export const PURCHASE_CREDIT_NOTE_SOURCE_INVALID_MESSAGE = 'ไม่พบ Invoice ต้นทาง หรือ Invoice ต้นทางถูกยกเลิกแล้ว'
export const PURCHASE_EXPENSE_REQUIRES_PO_MESSAGE = 'PR ต้องยืนยันแล้วและมีเลข PO หรือไฟล์ PO ก่อนบันทึกค่าใช้จ่าย'
export const PURCHASE_EXPENSE_CEILING_MESSAGE = 'ยอดค่าใช้จ่ายสุทธิ active เกินยอดรวม PR'
export const PURCHASE_INVOICE_HAS_ACTIVE_CREDIT_NOTES_MESSAGE = 'Invoice นี้มีใบลดหนี้ที่ยังใช้งานอยู่ จึงยังยกเลิกไม่ได้'
export const PURCHASE_INVOICE_BELOW_ACTIVE_CREDITS_MESSAGE = 'ยอด Invoice ใหม่ต้องไม่น้อยกว่ายอดใบลดหนี้ที่ใช้งานอยู่'

export interface PurchaseRequestExpenseRpcError {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

export function normalizePurchaseRequestInvoice(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase('th-TH') ?? ''
  return normalized || null
}

export function hasDuplicatePurchaseRequestInvoice(
  events: ReadonlyArray<Pick<PurchaseRequestExpenseRecord, 'id' | 'status' | 'invoiceNumber'>>,
  invoiceNumber: string | null | undefined,
  excludeExpenseId?: string | null,
): boolean {
  const normalized = normalizePurchaseRequestInvoice(invoiceNumber)
  if (!normalized) return false
  return events.some((event) => (
    event.id !== excludeExpenseId
    && normalizePurchaseRequestInvoice(event.invoiceNumber) === normalized
  ))
}

export function isRedCrossPurchaseRequest(method: PurchaseMethodKind): boolean {
  return method === 'red_cross'
}

export function hasPurchaseOrderEvidence(poNumber: string | null, poFileName: string | null): boolean {
  return Boolean(poNumber?.trim() || poFileName?.trim())
}

export function canRecordPurchaseRequestExpense(input: {
  status: PurchaseRequestStatus
  purchaseMethod: PurchaseMethodKind
  poNumber: string | null
  poFileName: string | null
}): boolean {
  return isRedCrossPurchaseRequest(input.purchaseMethod)
    && ['completed', 'partially_received', 'received', 'closed_short'].includes(input.status)
    && hasPurchaseOrderEvidence(input.poNumber, input.poFileName)
}

export function purchaseRequestExpenseSignedAmount(
  event: Pick<PurchaseRequestExpenseRecord, 'status' | 'amount' | 'documentType'>,
): number {
  if (event.status !== 'active') return 0
  return event.documentType === 'credit_note' ? -event.amount : event.amount
}

export function purchaseRequestExpenseNetTotal(
  events: ReadonlyArray<Pick<PurchaseRequestExpenseRecord, 'status' | 'amount' | 'documentType'>>,
): number {
  return roundCurrency(events.reduce((sum, event) => sum + purchaseRequestExpenseSignedAmount(event), 0))
}

type PurchaseExpenseDisplayEvent = Pick<PurchaseRequestExpenseRecord, 'id' | 'expenseDate' | 'createdAt' | 'documentType' | 'sourceExpenseId'>

/** Keep credit notes directly under the invoice they reference. */
export function purchaseRequestExpenseEventsForDisplay<T extends PurchaseExpenseDisplayEvent>(
  events: readonly T[],
  direction: 'asc' | 'desc' = 'desc',
): T[] {
  const compare = (left: T, right: T) => {
    const date = left.expenseDate.localeCompare(right.expenseDate)
    if (date !== 0) return direction === 'asc' ? date : -date
    const created = left.createdAt.localeCompare(right.createdAt)
    if (created !== 0) return direction === 'asc' ? created : -created
    const id = left.id.localeCompare(right.id)
    return direction === 'asc' ? id : -id
  }
  const invoices = events.filter((event) => event.documentType === 'invoice').slice().sort(compare)
  const creditsBySource = new Map<string, T[]>()
  const unlinked: T[] = []
  for (const event of events.filter((entry) => entry.documentType === 'credit_note')) {
    if (!event.sourceExpenseId) {
      unlinked.push(event)
      continue
    }
    const rows = creditsBySource.get(event.sourceExpenseId) ?? []
    rows.push(event)
    creditsBySource.set(event.sourceExpenseId, rows)
  }
  return invoices.flatMap((invoice) => [invoice, ...(creditsBySource.get(invoice.id) ?? []).slice().sort(compare)])
    .concat(unlinked.slice().sort(compare))
}

export interface PurchaseCreditNoteSourceOption {
  id: string
  invoiceNumber: string | null
  originalAmount: number
  creditedAmount: number
  remainingAmount: number
}

export function purchaseCreditNoteSourceOptions(
  events: ReadonlyArray<Pick<PurchaseRequestExpenseRecord, 'id' | 'status' | 'amount' | 'invoiceNumber' | 'documentType' | 'sourceExpenseId'>>,
): PurchaseCreditNoteSourceOption[] {
  const creditedBySource = new Map<string, number>()
  for (const event of events) {
    if (event.documentType !== 'credit_note' || event.status !== 'active' || !event.sourceExpenseId) continue
    creditedBySource.set(event.sourceExpenseId, (creditedBySource.get(event.sourceExpenseId) ?? 0) + event.amount)
  }
  return events
    .filter((event) => event.documentType === 'invoice' && event.status === 'active')
    .map((event) => {
      const originalAmount = roundCurrency(event.amount)
      const creditedAmount = roundCurrency(creditedBySource.get(event.id) ?? 0)
      return {
        id: event.id,
        invoiceNumber: event.invoiceNumber,
        originalAmount,
        creditedAmount,
        remainingAmount: Math.max(0, roundCurrency(originalAmount - creditedAmount)),
      }
    })
    .filter((option) => option.remainingAmount > 0)
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isPurchaseRequestExpenseDuplicateError(error: PurchaseRequestExpenseRpcError | null | undefined): boolean {
  if (error?.code !== '23505') return false
  return [error.message, error.details, error.hint]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.includes('purchase_request_expenses_invoice_unique'))
}
