import { z } from 'zod'
import { isoDateSchema } from '@/lib/validation/date'

export const PURCHASE_METHODS = [
  'annual_plan',
  'contract',
  'awaiting_contract',
  'off_plan',
  'specific_contract',
  'e_bidding',
] as const

export type PurchaseMethodKind = (typeof PURCHASE_METHODS)[number]

export const PURCHASE_REQUEST_STATUSES = [
  'draft',
  'pending',
  'completed',
  'cancelled',
  'reversed',
] as const

export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number]

export const purchaseMethodSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('annual_plan'),
    fiscalYear: z.number().int().min(2500).max(3000),
    planSequence: z.string().trim().min(1, 'กรุณาระบุลำดับในแผนจัดซื้อ'),
  }),
  z.object({
    kind: z.literal('contract'),
    contractId: z.number().int().positive(),
    purchaseSequence: z.number().int().positive('ครั้งที่ซื้อต้องเริ่มจาก 1'),
  }),
  z.object({
    kind: z.literal('awaiting_contract'),
    reference: z.string().trim().min(1, 'กรุณาระบุเอกสารอ้างอิงระหว่างรอทำสัญญา'),
  }),
  z.object({ kind: z.literal('off_plan') }),
  z.object({ kind: z.literal('specific_contract') }),
  z.object({ kind: z.literal('e_bidding') }),
])

export type PurchaseMethod = z.infer<typeof purchaseMethodSchema>

/** Only a contract purchase draws down contracted quantity. */
export function methodRequiresContractItems(method: PurchaseMethod): boolean {
  return method.kind === 'contract'
}

const TRANSITIONS: Record<PurchaseRequestStatus, PurchaseRequestStatus[]> = {
  draft: ['pending', 'cancelled'],
  pending: ['completed', 'cancelled'],
  // A confirmed PR already moved contracted quantity, so undoing it is an
  // audited reversal rather than a cancellation.
  completed: ['reversed'],
  cancelled: [],
  reversed: [],
}

export function allowedPurchaseRequestTransitions(
  status: PurchaseRequestStatus,
): PurchaseRequestStatus[] {
  return TRANSITIONS[status]
}

/** Matches the generated `line_total numeric(17,2)` column in Postgres. */
export function calculateLineTotal(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 100) / 100
}

export function formatPurchaseRequestNumber(fiscalYear: number, sequence: number): string {
  return `PR-${fiscalYear}-${String(sequence).padStart(4, '0')}`
}

export const purchaseRequestLineSchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    contractItemId: z.string().uuid().nullable(),
    requestedQuantity: z.number().finite().positive('จำนวนที่ขอซื้อต้องมากกว่า 0'),
    unit: z.string().trim().min(1, 'กรุณาระบุหน่วย'),
    unitPrice: z.number().finite().nonnegative('ราคาต่อหน่วยต้องไม่ติดลบ'),
  })
  .strict()

export const purchaseRequestInputSchema = z
  .object({
    department: z.string().trim().min(1, 'กรุณาระบุหน่วยงานผู้ขอ'),
    headName: z.string().trim().min(1, 'กรุณาระบุชื่อหัวหน้ากลุ่มงาน'),
    requestedDate: isoDateSchema,
    note: z.string().trim().max(1000).nullable(),
    method: purchaseMethodSchema,
    items: z.array(purchaseRequestLineSchema).min(1, 'ต้องมีรายการขอซื้ออย่างน้อย 1 รายการ'),
  })
  .strict()
  .superRefine((value, context) => {
    const requiresContractItems = methodRequiresContractItems(value.method)

    value.items.forEach((item, index) => {
      if (requiresContractItems && !item.contractItemId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'contractItemId'],
          message: 'การซื้อตามสัญญาต้องเลือกรายการในสัญญาให้ครบทุกบรรทัด',
        })
      }

      if (!requiresContractItems && item.contractItemId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'contractItemId'],
          message: 'วิธีจัดซื้อนี้ไม่ตัดยอดจากสัญญา',
        })
      }
    })

    // The database enforces this too, but catching it here names the offending
    // line instead of surfacing a unique-violation.
    const contractItemIds = value.items
      .map((item) => item.contractItemId)
      .filter((id): id is string => id !== null)
    if (new Set(contractItemIds).size !== contractItemIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'รายการในสัญญาซ้ำกันภายในใบ PR เดียวกัน',
      })
    }

    const inventoryItemIds = value.items.map((item) => item.inventoryItemId)
    if (new Set(inventoryItemIds).size !== inventoryItemIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'น้ำยารายการเดียวกันซ้ำกันภายในใบ PR เดียวกัน',
      })
    }
  })

export const purchaseOrderNumberSchema = z
  .object({ poNumber: z.string().trim().min(1, 'กรุณาระบุเลขที่ใบสั่งซื้อ') })
  .strict()

export const purchaseRequestReversalSchema = z
  .object({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลในการกลับรายการ') })
  .strict()
