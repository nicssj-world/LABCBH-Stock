import { z } from 'zod'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { isoDateSchema } from '@/lib/validation/date'
import { PROCUREMENT_STAGES, allowedNextStages } from '@/lib/contracts/stages'

/**
 * The register holds one contract type — จ้างตรวจทางห้องปฏิบัติการ — in two
 * shapes, which is what `kind` names:
 *
 *   contract_ceiling  a signed contract with its own value and dates. Spending
 *                     is capped at that value by the database.
 *   annual_plan       a budget planned for one fiscal year, re-registered each
 *                     year, with no procurement stages. Over-plan is surfaced
 *                     rather than blocked.
 */
export const OUT_LAB_KINDS = ['contract_ceiling', 'annual_plan'] as const

/**
 * How often a figure is expected. Independent of `kind` — ไทรอยด์ is an annual
 * plan filled in monthly, HIV is an annual plan filled in quarterly. Used only
 * to point out a period nobody filled in; it never blocks a write.
 */
export const OUT_LAB_CADENCES = ['monthly', 'quarterly', 'as_needed'] as const

export const OUT_LAB_DEPARTMENTS = DEPARTMENTS

type OutLabKindValue = (typeof OUT_LAB_KINDS)[number]

/**
 * An annual plan's period is its fiscal year, so it is derived by the RPC
 * rather than typed. The create RPC rejects the date keys outright; this keeps
 * the message in Thai and on the right field instead of surfacing a raw 22023.
 */
function refinePeriodForKind(
  value: { kind: OutLabKindValue; startDate?: string | null; endDate?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.kind === 'annual_plan') {
    if (value.startDate != null || value.endDate != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'สัญญางบตามแผนใช้ช่วงเวลาตามปีงบประมาณ ไม่ต้องระบุวันที่',
      })
    }
    return
  }

  if (!value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: 'กรุณาระบุวันเริ่มสัญญา',
    })
  }

  if (!value.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'กรุณาระบุวันสิ้นสุดสัญญา',
    })
  }

  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'วันสิ้นสุดสัญญาต้องไม่มาก่อนวันเริ่มสัญญา',
    })
  }
}

const outLabContractFields = {
  kind: z.enum(OUT_LAB_KINDS, { errorMap: () => ({ message: 'กรุณาเลือกรูปแบบงบของสัญญา' }) }),
  entryCadence: z.enum(OUT_LAB_CADENCES, { errorMap: () => ({ message: 'กรุณาเลือกงวดการลงข้อมูล' }) }),
  fiscalYear: z.number().int().min(2500).max(3000),
  displayName: z.string().trim().min(1, 'กรุณาระบุชื่อสัญญา'),
  vendor: z.string().trim().min(1, 'กรุณาระบุคู่สัญญา').nullable(),
  department: z
    .enum(OUT_LAB_DEPARTMENTS, { errorMap: () => ({ message: 'กรุณาเลือกหน่วยงาน' }) })
    .nullable(),
  // A null ceiling means "not stated", never zero. The two mean opposite things
  // to whoever is deciding whether there is room to spend.
  total: z.number().finite().positive('มูลค่าสัญญาต้องมากกว่า 0').nullable(),
  startDate: isoDateSchema.nullable().optional(),
  endDate: isoDateSchema.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}

export const outLabCreateInputSchema = z
  .object({
    ...outLabContractFields,
    // Admin-only fast path: registers a contract that already started, at
    // contract_started rather than sent_to_procurement.
    contractNumber: z.string().trim().min(1, 'กรุณาระบุเลขที่สัญญา').nullable().optional(),
    effectiveDate: isoDateSchema.nullable().optional(),
  })
  .strict()
  .superRefine(refinePeriodForKind)
  .superRefine((value, ctx) => {
    if (value.kind === 'annual_plan') {
      if (value.contractNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contractNumber'],
          message: 'สัญญางบตามแผนไม่มีขั้นตอนจัดซื้อ จึงไม่ต้องระบุเลขที่สัญญา',
        })
      }
      return
    }

    if (!value.effectiveDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveDate'],
        message: 'กรุณาระบุวันที่มีผลของขั้นตอนแรก',
      })
    }
  })

export const outLabUpdateInputSchema = z
  .object({
    ...outLabContractFields,
    expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine(refinePeriodForKind)

export const outLabUsageInputSchema = z
  .object({
    contractId: z.string().uuid(),
    amount: z.number().finite().positive('จำนวนเงินต้องมากกว่า 0'),
    usageMonth: isoDateSchema,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export const outLabResponsibleUsersInputSchema = z
  .object({
    contractId: z.string().uuid(),
    profileIds: z.array(z.string().uuid()),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export const outLabStageAdvanceSchema = z
  .object({
    from: z.enum(PROCUREMENT_STAGES),
    to: z.enum(PROCUREMENT_STAGES),
    effectiveDate: isoDateSchema,
    contractNumber: z.string().trim().min(1).nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!allowedNextStages(value.from).includes(value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'ขั้นตอนสัญญาต้องเปลี่ยนตามลำดับเท่านั้น',
      })
    }

    if (value.to === 'contract_started' && !value.contractNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractNumber'],
        message: 'ต้องระบุเลขที่สัญญาเมื่อเริ่มสัญญา',
      })
    }

    if (value.to !== 'contract_started' && value.contractNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractNumber'],
        message: 'เลขที่สัญญาจะกำหนดได้เมื่อเริ่มสัญญาเท่านั้น',
      })
    }
  })

export const outLabArchiveInputSchema = z
  .object({
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่เก็บเข้าคลัง').max(500),
  })
  .strict()

export const outLabExpireInputSchema = z
  .object({
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่สิ้นสุดสัญญา').max(500),
  })
  .strict()
