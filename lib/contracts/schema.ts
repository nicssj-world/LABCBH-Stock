import { z } from 'zod'
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

export const createContractInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2500).max(3000),
    contractType: z.enum(CONTRACT_TYPES),
    displayName: z.string().trim().min(1, 'กรุณาระบุชื่อสัญญา'),
    vendor: z.string().trim().min(1, 'กรุณาระบุคู่สัญญา').nullable(),
    endDate: isoDateSchema.nullable(),
    sentToProcurementDate: isoDateSchema,
    items: z.array(contractLineInputSchema),
  })
  .strict()
  .superRefine(refineItemsForContractType)

export const updateContractInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2500).max(3000),
    contractType: z.enum(CONTRACT_TYPES),
    displayName: z.string().trim().min(1, 'กรุณาระบุชื่อสัญญา'),
    vendor: z.string().trim().min(1, 'กรุณาระบุคู่สัญญา').nullable(),
    endDate: isoDateSchema.nullable(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
    items: z.array(contractItemUpdateInputSchema),
  })
  .strict()
  .superRefine(refineItemsForContractType)

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

export const stageAdvanceSchema = z
  .object({
    from: z.enum(PROCUREMENT_STAGES),
    to: z.enum(PROCUREMENT_STAGES),
    effectiveDate: isoDateSchema,
    contractNumber: z.string().trim().min(1).nullable().optional(),
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
  })

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
