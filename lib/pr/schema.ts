import { z } from 'zod'
import type { ContractType } from '@/lib/contracts/types'
import { normalizeLsCode } from '@/lib/inventory/ls-code'
import { isoDateSchema } from '@/lib/validation/date'

export const PURCHASE_METHODS = [
  'annual_plan',
  'contract',
  'awaiting_contract',
  'off_plan',
  'specific_contract',
  'e_bidding',
  'equipment_lease',
] as const

export type PurchaseMethodKind = (typeof PURCHASE_METHODS)[number]

/**
 * Every method belongs to exactly one purpose: ordering against an existing
 * arrangement (to issue a PO), or originating a brand-new contract. This is
 * purely a UI grouping over the same six methods — nothing new is stored.
 */
export const PURCHASE_PURPOSES = ['purchase_order', 'new_contract'] as const

export type PurchasePurpose = (typeof PURCHASE_PURPOSES)[number]

export const PURCHASE_METHODS_BY_PURPOSE = {
  purchase_order: ['annual_plan', 'contract', 'awaiting_contract', 'off_plan'],
  new_contract: ['specific_contract', 'e_bidding', 'equipment_lease'],
} as const satisfies Record<PurchasePurpose, readonly PurchaseMethodKind[]>

export function purchaseMethodPurpose(kind: PurchaseMethodKind): PurchasePurpose {
  return (PURCHASE_METHODS_BY_PURPOSE.new_contract as readonly PurchaseMethodKind[]).includes(kind)
    ? 'new_contract'
    : 'purchase_order'
}

const METHOD_CONTRACT_TYPE: Partial<Record<PurchaseMethodKind, ContractType>> = {
  specific_contract: 'specific',
  e_bidding: 'e_bidding',
  equipment_lease: 'equipment_lease',
}

/** The contract type auto-filled when this method originates a new contract. */
export function contractTypeForMethod(kind: PurchaseMethodKind): ContractType | null {
  return METHOD_CONTRACT_TYPE[kind] ?? null
}

export const PURCHASE_REQUEST_STATUSES = [
  'draft',
  'pending',
  'completed',
  'partially_received',
  'received',
  'closed_short',
  'cancelled',
  'reversed',
] as const

export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number]

const contractDraftBaseSchema = z.object({
  fiscalYear: z.number().int().min(2500).max(3000),
  displayName: z.string().trim().min(1, 'กรุณาระบุชื่อสัญญา'),
  sentToStockOfficerDate: isoDateSchema,
})

/**
 * The minimal facts needed to open a contract at stage 1 (ส่งพัสดุ) once the
 * stock officer confirms. Department and contract type are not carried here:
 * department mirrors the PR's own requester department, and contract type is
 * derived from the method kind via `contractTypeForMethod`.
 *
 * Vendor is required here (ทำสัญญาเจาะจง already knows who the vendor is), but
 * not for e_bidding/equipment_lease — see contractDraftWithOptionalVendorSchema.
 */
export const contractDraftSchema = contractDraftBaseSchema
  .extend({
    vendor: z.string().trim().min(1, 'กรุณาระบุคู่สัญญา').nullable(),
  })
  .strict()

/**
 * E-Bidding and a new lease are both requested before the vendor is decided
 * — bidding hasn't run, or the lessor isn't chosen yet — so vendor is left
 * blank rather than forced.
 */
export const contractDraftWithOptionalVendorSchema = contractDraftBaseSchema
  .extend({
    vendor: z.string().trim().nullable(),
  })
  .strict()

export type ContractDraft = z.infer<typeof contractDraftSchema>

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
    contractId: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('off_plan') }),
  z.object({
    kind: z.literal('specific_contract'),
    contractDraft: contractDraftSchema,
  }),
  z.object({
    kind: z.literal('e_bidding'),
    contractDraft: contractDraftWithOptionalVendorSchema,
  }),
  z.object({
    kind: z.literal('equipment_lease'),
    // A lease does carry a ceiling, but not yet. When this request is written
    // procurement has not run, so any figure here is an estimate negotiation
    // can still move, and recording it would put a number in the register
    // nobody can defend. advance_contract_stage collects the real one at
    // contract_started, alongside the contract number. The direct "เพิ่มสัญญา"
    // form is the exception — it records a contract that already exists
    // outside this workflow, so it still asks up front.
    contractDraft: contractDraftWithOptionalVendorSchema,
  }),
])

export type PurchaseMethod = z.infer<typeof purchaseMethodSchema>

/** Only a purchase against an already-started contract draws down its quantity. */
export function methodRequiresContractItems(method: PurchaseMethod): boolean {
  return method.kind === 'contract'
}

/** A PR whose method originates a brand-new contract once confirmed. */
export function methodCreatesContract(method: PurchaseMethod): boolean {
  return contractTypeForMethod(method.kind) !== null
}

const TRANSITIONS: Record<PurchaseRequestStatus, PurchaseRequestStatus[]> = {
  draft: ['pending', 'cancelled'],
  pending: ['completed', 'cancelled'],
  // A confirmed PR already moved contracted quantity, so undoing it is an
  // audited reversal rather than a cancellation.
  completed: ['partially_received', 'received', 'reversed'],
  partially_received: ['received', 'closed_short'],
  received: [],
  closed_short: [],
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
    // Null means the requester typed a new catalogue line. The create RPC
    // creates the inventory row before it inserts the PR line, in the same
    // transaction.
    inventoryItemId: z.string().uuid().nullable(),
    lsCode: z.string().trim().max(100, 'รหัสน้ำยายาวเกินไป').nullable().optional(),
    name: z.string().trim().max(240, 'ชื่อน้ำยาต้องไม่เกิน 240 ตัวอักษร').nullable().optional(),
    contractItemId: z.string().uuid().nullable(),
    requestedQuantity: z.number().finite().positive('จำนวนที่ขอซื้อต้องมากกว่า 0'),
    unit: z.string().trim().min(1, 'กรุณาระบุหน่วย'),
    unitPrice: z.number().finite().nonnegative('ราคาต่อหน่วยต้องไม่ติดลบ'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inventoryItemId !== null) return

    if (!value.lsCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lsCode'],
        message: 'รายการใหม่ต้องระบุรหัสน้ำยา (LS)',
      })
    }
    if (!value.name) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'รายการใหม่ต้องระบุชื่อน้ำยา',
      })
    }
  })

export const purchaseRequestInputSchema = z
  .object({
    department: z.string().trim().min(1, 'กรุณาระบุหน่วยงานผู้ขอ'),
    headName: z.string().trim().min(1, 'กรุณาระบุหัวหน้างาน'),
    requestedDate: isoDateSchema,
    note: z.string().trim().max(1000).nullable(),
    method: purchaseMethodSchema,
    items: z.array(purchaseRequestLineSchema),
  })
  .strict()
  .superRefine((value, context) => {
    // A lease has no reagent lines to pick — it originates a contract with
    // zero contract_items, same invariant create_contract already enforces.
    // Every other method still needs at least one line.
    if (value.method.kind !== 'equipment_lease' && value.items.length < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'ต้องมีรายการขอซื้ออย่างน้อย 1 รายการ',
      })
    }

    if (value.method.kind === 'equipment_lease' && value.items.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'การเช่าเครื่องไม่มีรายการขอซื้อ',
      })
    }

    const requiresContractItems = methodRequiresContractItems(value.method)
    // Every line here becomes a contract_items row the moment the stock
    // officer confirms; catching a free/zero price now (instead of at
    // create_contract's own check) means the officer never hits an opaque
    // database error on a PR that isn't theirs to fix.
    const createsContract = methodCreatesContract(value.method)

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

      if (createsContract && item.unitPrice <= 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'unitPrice'],
          message: 'รายการที่จะกลายเป็นรายการในสัญญาต้องระบุราคาต่อหน่วยมากกว่า 0',
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

    const inventoryItemIds = value.items
      .map((item) => item.inventoryItemId)
      .filter((id): id is string => id !== null)
    if (new Set(inventoryItemIds).size !== inventoryItemIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'น้ำยารายการเดียวกันซ้ำกันภายในใบ PR เดียวกัน',
      })
    }

    const manualLsCodes = value.items
      .filter((item) => item.inventoryItemId === null)
      .map((item) => normalizeLsCode(item.lsCode ?? ''))
      .filter(Boolean)
    if (new Set(manualLsCodes).size !== manualLsCodes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'รหัสน้ำยารายการใหม่ซ้ำกันภายในใบ PR เดียวกัน',
      })
    }
  })

export const purchaseOrderNumberSchema = z
  .object({ poNumber: z.string().trim().min(1, 'กรุณาระบุเลขที่ใบสั่งซื้อ') })
  .strict()

export const ephisPrNumberSchema = z
  .object({ ephisPrNumber: z.string().trim().min(1, 'กรุณาระบุเลข PR จาก E-Phis') })
  .strict()

export const purchaseRequestReversalSchema = z
  .object({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลในการกลับรายการ') })
  .strict()

export const purchaseRequestShortCloseSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'กรุณาระบุเหตุผลในการปิดยอดคงเหลือ')
      .max(1000, 'เหตุผลต้องไม่เกิน 1,000 ตัวอักษร'),
  })
  .strict()
