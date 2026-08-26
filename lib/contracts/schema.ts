import { z } from 'zod'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { isoDateSchema } from '@/lib/validation/date'
import { PROCUREMENT_STAGES, allowedNextStages } from './stages'

type ContractTypeValue = (typeof CONTRACT_TYPES)[number]

export const CONTRACT_TYPES = [
  'equipment_lease',
  'e_bidding',
  'annual_specific',
  'specific',
  'off_plan',
  'awaiting_equipment_lease',
  'thai_red_cross',
] as const

/** Supported contract terms for purchase requests that open a new contract. */
export const CONTRACT_DURATION_YEARS = [1, 3] as const
export const contractDurationYearsSchema = z.union([
  z.literal(CONTRACT_DURATION_YEARS[0]),
  z.literal(CONTRACT_DURATION_YEARS[1]),
], { errorMap: () => ({ message: 'กรุณาระบุจำนวนปีที่ทำสัญญา (1 หรือ 3 ปี)' }) })

// The lab section that owns a contract. Carried over verbatim from the
// legacy portal's own department list so a contract migrated from there
// keeps matching against the same set of names.
export const CONTRACT_DEPARTMENTS = DEPARTMENTS

export const contractLineInputSchema = z.object({
  lsCode: z.string().trim().min(1, 'กรุณาระบุรหัสน้ำยา (LS)'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อน้ำยา'),
  quantity: z.number().finite().positive('จำนวนในสัญญาต้องมากกว่า 0'),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วย'),
  unitPrice: z.number().finite().positive('ราคาต่อหน่วยต้องมากกว่า 0'),
})

export const contractItemUpdateInputSchema = contractLineInputSchema.extend({
  id: z.string().uuid().nullable(),
})

/**
 * Create-only: how much of this line was already used outside the system
 * before the contract was registered here (paper-signed, partially spent
 * e-bidding contracts). Deliberately not part of contractItemUpdateInputSchema
 * — update_contract's item allowlist has no such key, and adding it there
 * would trip its "unexpected contract item field" guard.
 */
export const contractCreateLineInputSchema = contractLineInputSchema
  .extend({
    openingUsedQuantity: z.number().finite().nonnegative('ยอดใช้ก่อนเข้าระบบต้องไม่ติดลบ').nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.openingUsedQuantity != null && value.openingUsedQuantity > value.quantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['openingUsedQuantity'],
        message: 'ยอดใช้ก่อนเข้าระบบต้องไม่เกินจำนวนในสัญญา',
      })
    }
  })

/**
 * An equipment lease is billed in baht against a ceiling and holds no line
 * items; the database rejects them outright. Every other contract type still
 * needs at least one. Applied to create and update alike, or a lease could be
 * created and then not edited.
 */
function refineItemsForContractType(
  value: { contractType: ContractTypeValue; items: unknown[] },
  ctx: z.RefinementCtx,
): void {
  if (value.contractType === 'equipment_lease') {
    if (value.items.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'สัญญาเช่าเครื่องไม่มีรายการน้ำยา',
      })
    }
    return
  }
  if (value.items.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'ต้องมีรายการน้ำยาอย่างน้อย 1 รายการ',
    })
  }
}

const contractTotalInputSchema = z
  .number()
  .finite()
  .positive('มูลค่าสัญญาต้องมากกว่า 0')
  .nullable()
  .optional()

/**
 * Editing is deliberately more permissive than creating. A lease opened from a
 * purchase request has no ceiling until it reaches contract_started, and
 * refusing to parse one here would leave it uneditable for the whole of
 * procurement. Whether a started lease may have its ceiling cleared is a
 * question about the contract's stage, which only the locked row inside
 * update_contract can answer — so that rule lives there, not here.
 */
function refineTotalForContractTypeOnUpdate(
  value: { contractType: ContractTypeValue; total?: number | null },
  ctx: z.RefinementCtx,
): void {
  const hasTotal = Object.prototype.hasOwnProperty.call(value, 'total')

  if (value.contractType === 'equipment_lease') {
    if (!hasTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: 'กรุณาระบุมูลค่าสัญญา',
      })
    }
    return
  }

  if (hasTotal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['total'],
      message: 'มูลค่าสัญญาระบุได้เฉพาะสัญญาเช่าเครื่อง',
    })
  }
}

/** Lease ceilings are entered directly; supply totals remain derived from lines. */
function refineTotalForContractType(
  value: { contractType: ContractTypeValue; total?: number | null },
  ctx: z.RefinementCtx,
): void {
  const hasTotal = Object.prototype.hasOwnProperty.call(value, 'total')

  if (value.contractType === 'equipment_lease') {
    if (value.total == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: 'กรุณาระบุมูลค่าสัญญา',
      })
    }
    return
  }

  if (hasTotal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['total'],
      message: 'มูลค่าสัญญาระบุได้เฉพาะสัญญาเช่าเครื่อง',
    })
  }
}

/**
 * A per-line opening balance only means something on the admin fast path: a
 * contract that never fabricates procurement stages already has a contract
 * number, while one that still climbs the normal stages has nothing to
 * reconcile against yet.
 */
function refineOpeningBalanceRequiresContractNumber(
  value: { contractNumber?: string | null; items: { openingUsedQuantity?: number | null }[] },
  ctx: z.RefinementCtx,
): void {
  if (value.contractNumber) return
  value.items.forEach((item, index) => {
    if (item.openingUsedQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'openingUsedQuantity'],
        message: 'ยอดใช้ก่อนเข้าระบบระบุได้เฉพาะสัญญาที่เริ่มใช้งานแล้ว',
      })
    }
  })
}

export const createContractInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2500).max(3000),
    contractType: z.enum(CONTRACT_TYPES),
    contractDurationYears: contractDurationYearsSchema,
    department: z.enum(CONTRACT_DEPARTMENTS, { errorMap: () => ({ message: 'กรุณาเลือกหน่วยงาน' }) }),
    displayName: z.string().trim().min(1, 'กรุณาระบุชื่อสัญญา'),
    vendor: z.string().trim().min(1, 'กรุณาระบุคู่สัญญา').nullable(),
    endDate: isoDateSchema.nullable(),
    total: contractTotalInputSchema,
    sentToProcurementDate: isoDateSchema,
    // Only set on the admin-only "already started" fast path: creates the
    // contract directly at contract_started instead of sent_to_procurement.
    contractNumber: z.string().trim().min(1, 'กรุณาระบุเลขที่สัญญา').nullable().optional(),
    items: z.array(contractCreateLineInputSchema),
  })
  .strict()
  .superRefine(refineItemsForContractType)
  .superRefine(refineTotalForContractType)
  .superRefine(refineOpeningBalanceRequiresContractNumber)

export const updateContractInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2500).max(3000),
    contractType: z.enum(CONTRACT_TYPES),
    contractDurationYears: contractDurationYearsSchema,
    department: z.enum(CONTRACT_DEPARTMENTS, { errorMap: () => ({ message: 'กรุณาเลือกหน่วยงาน' }) }),
    displayName: z.string().trim().min(1, 'กรุณาระบุชื่อสัญญา'),
    vendor: z.string().trim().min(1, 'กรุณาระบุคู่สัญญา').nullable(),
    endDate: isoDateSchema.nullable(),
    total: contractTotalInputSchema,
    expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
    items: z.array(contractItemUpdateInputSchema),
  })
  .strict()
  .superRefine(refineItemsForContractType)
  .superRefine(refineTotalForContractTypeOnUpdate)

export const contractExpenseInputSchema = z
  .object({
    contractId: z.number().int().positive(),
    amount: z.number().finite().positive('จำนวนเงินต้องมากกว่า 0'),
    usageMonth: isoDateSchema,
    usageDate: isoDateSchema.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export const responsibleUsersInputSchema = z
  .object({
    contractId: z.number().int().positive(),
    profileIds: z.array(z.string().uuid()),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export const archiveContractInputSchema = z
  .object({
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ยกเลิก/เก็บถาวร'),
  })
  .strict()

export const expireContractInputSchema = z
  .object({
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่สิ้นสุดสัญญา').max(500),
  })
  .strict()

export const contractOpeningBalanceLineInputSchema = z
  .object({
    contractItemId: z.string().uuid(),
    usedQuantity: z.number().finite().nonnegative('ยอดใช้ก่อนเข้าระบบต้องไม่ติดลบ'),
  })
  .strict()

export const contractOpeningBalanceInputSchema = z
  .object({
    effectiveDate: isoDateSchema,
    note: z.string().trim().min(1, 'กรุณาระบุที่มาของยอดใช้ก่อนเข้าระบบ').max(1000),
    lines: z.array(contractOpeningBalanceLineInputSchema).min(1, 'ต้องมีอย่างน้อย 1 รายการ'),
  })
  .strict()

export const stageAdvanceSchema = z
  .object({
    from: z.enum(PROCUREMENT_STAGES),
    to: z.enum(PROCUREMENT_STAGES),
    effectiveDate: isoDateSchema,
    contractNumber: z.string().trim().min(1).nullable().optional(),
    // Like `from`, an optimistic client assertion used only to decide whether
    // to ask for a ceiling. advance_contract_stage reads the real type from
    // the locked row and enforces the rule there.
    contractType: z.enum(CONTRACT_TYPES).optional(),
    // A lease's ceiling is settled at contract_started, not when the contract
    // is opened: procurement can still negotiate the price down before then.
    total: z.number().finite().positive('มูลค่าสัญญาต้องมากกว่า 0').nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!allowedNextStages(value.from).includes(value.to)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'ขั้นตอนสัญญาต้องเปลี่ยนตามลำดับเท่านั้น',
      })
    }

    if (value.to === 'contract_started' && !value.contractNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractNumber'],
        message: 'ต้องระบุเลขที่สัญญาเมื่อเริ่มสัญญา',
      })
    }

    if (value.to !== 'contract_started' && value.contractNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractNumber'],
        message: 'เลขที่สัญญาจะกำหนดได้เมื่อเริ่มสัญญาเท่านั้น',
      })
    }

    // Mirrors advance_contract_stage: without a ceiling the over-budget guard
    // in record_contract_expense silently passes every entry, so a lease must
    // not be allowed to start without one.
    if (
      value.to === 'contract_started'
      && value.contractType === 'equipment_lease'
      && value.total == null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: 'ต้องระบุมูลค่าสัญญาเมื่อเริ่มสัญญาเช่าเครื่อง',
      })
    }

    if (value.contractType != null && value.contractType !== 'equipment_lease' && value.total != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: 'มูลค่าสัญญาระบุได้เฉพาะสัญญาเช่าเครื่อง',
      })
    }

    if (value.to !== 'contract_started' && value.total != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: 'มูลค่าสัญญาจะกำหนดได้เมื่อเริ่มสัญญาเท่านั้น',
      })
    }
  })

export const stageHistoryCorrectionInputSchema = z
  .object({
    historyId: z.string().uuid(),
    effectiveDate: isoDateSchema,
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่แก้ไขวันที่').max(1000),
  })
  .strict()

export const stageHistoryBackfillInputSchema = z
  .object({
    toStage: z.enum(PROCUREMENT_STAGES),
    effectiveDate: isoDateSchema,
    note: z.string().trim().min(1, 'กรุณาระบุหมายเหตุการบันทึกย้อนหลัง').max(1000),
  })
  .strict()

export const contractInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2500).max(3000),
    contractType: z.enum(CONTRACT_TYPES),
    procurementStage: z.enum(PROCUREMENT_STAGES),
    status: z.enum(['active', 'expired', 'cancelled', 'pending']),
    displayName: z.string().trim().min(1, 'กรุณาระบุชื่อสัญญา'),
    vendor: z.string().trim().min(1, 'กรุณาระบุคู่สัญญา').nullable(),
    contractNumber: z.string().trim().min(1).nullable(),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
    items: z.array(contractLineInputSchema),
  })
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น',
      })
    }

    if (value.procurementStage === 'contract_started' && !value.contractNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractNumber'],
        message: 'ต้องระบุเลขที่สัญญาเมื่อเริ่มสัญญา',
      })
    }

    if (value.procurementStage === 'contract_started' && !value.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'ต้องระบุวันที่เริ่มใช้เมื่อเริ่มสัญญา',
      })
    }

    if (value.procurementStage === 'contract_started' && value.status === 'pending') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'สัญญาที่เริ่มใช้แล้วต้องไม่อยู่ในสถานะ pending',
      })
    }

    if (value.procurementStage !== 'contract_started' && value.contractNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractNumber'],
        message: 'เลขที่สัญญาจะกำหนดได้เมื่อเริ่มสัญญาเท่านั้น',
      })
    }

    if (
      value.procurementStage !== 'contract_started' &&
      !['pending', 'cancelled'].includes(value.status)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'สัญญาที่ยังไม่เริ่มใช้ต้องเป็น pending หรือ cancelled',
      })
    }
  })
