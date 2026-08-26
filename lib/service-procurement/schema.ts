import { z } from 'zod'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { isoDateSchema } from '@/lib/validation/date'

export const SERVICE_PLAN_TYPES = [
  'laboratory_testing',
  'medical_services',
  'personnel',
  'medical_equipment_maintenance',
  'other_services',
] as const

export type ServicePlanType = (typeof SERVICE_PLAN_TYPES)[number]

export const SERVICE_PLAN_TYPE_LABELS: Record<ServicePlanType, string> = {
  laboratory_testing: 'จ้างตรวจทางห้องปฏิบัติการ',
  medical_services: 'จ้างเหมาบริการทางการแพทย์',
  personnel: 'จ้างเหมาบุคคล',
  medical_equipment_maintenance: 'จ้างบำรุงรักษาครุภัณฑ์ทางการแพทย์',
  other_services: 'จ้างเหมาบริการอื่น',
}

export const SERVICE_PURCHASE_METHODS = ['annual_items', 'laboratory_testing'] as const
export type ServicePurchaseMethod = (typeof SERVICE_PURCHASE_METHODS)[number]

export const SERVICE_PR_STATUSES = ['pending', 'confirmed', 'closed', 'cancelled'] as const
export type ServicePrStatus = (typeof SERVICE_PR_STATUSES)[number]

export const SERVICE_PO_STATUSES = ['not_issued', 'open', 'closed', 'cancelled'] as const
export type ServicePoStatus = (typeof SERVICE_PO_STATUSES)[number]

export const SERVICE_FULFILLMENT_STATUSES = ['not_started', 'partial', 'complete'] as const
export type ServiceFulfillmentStatus = (typeof SERVICE_FULFILLMENT_STATUSES)[number]

export const SERVICE_ATTACHMENT_KINDS = ['tor', 'quotation'] as const
export type ServiceAttachmentKind = (typeof SERVICE_ATTACHMENT_KINDS)[number]

export const SERVICE_COMMITTEE_KINDS = ['specification', 'inspection'] as const
export type ServiceCommitteeKind = (typeof SERVICE_COMMITTEE_KINDS)[number]

const moneySchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => Math.round(value * 100) === value * 100, 'จำนวนเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง')
const signedMoneySchema = z
  .number()
  .finite()
  .refine((value) => Math.round(value * 100) === value * 100, 'จำนวนเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง')

const responsibleIdsSchema = z.array(z.string().uuid()).max(20)

export const servicePlanInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2500).max(3000),
    name: z.string().trim().min(1, 'กรุณาระบุชื่อแผน').max(240),
    department: z.enum(DEPARTMENTS, { errorMap: () => ({ message: 'กรุณาเลือกหน่วยงาน' }) }),
    budget: moneySchema.refine((value) => value > 0, 'วงเงินต้องมากกว่า 0'),
    type: z.enum(SERVICE_PLAN_TYPES),
    responsibleProfileIds: responsibleIdsSchema,
  })
  .strict()

export const servicePlanUpdateSchema = servicePlanInputSchema.extend({
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict()

export const servicePlanBudgetRevisionSchema = z
  .object({
    planId: z.string().uuid(),
    budget: moneySchema.refine((value) => value > 0, 'วงเงินต้องมากกว่า 0'),
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(1000),
  })
  .strict()

export const servicePlanHistoricalExpenseSchema = z
  .object({
    planId: z.string().uuid(),
    amount: moneySchema.refine((value) => value > 0, 'ยอดค่าใช้จ่ายต้องมากกว่า 0'),
    expenseDate: isoDateSchema,
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(1000),
    sourceReference: z.string().trim().min(1, 'กรุณาระบุแหล่งอ้างอิง').max(240),
  })
  .strict()

export const servicePlanExpenseAdjustmentSchema = z
  .object({
    planId: z.string().uuid(),
    amount: signedMoneySchema.refine((value) => value !== 0, 'ยอดปรับต้องไม่เป็น 0'),
    expenseDate: isoDateSchema,
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(1000),
    sourceReference: z.string().trim().min(1, 'กรุณาระบุแหล่งอ้างอิง').max(240),
    sourceLedgerId: z.string().uuid().nullable(),
  })
  .strict()

const serviceLineSchema = z.object({
  inventoryItemId: z.string().uuid().nullable(),
  lsCode: z.string().trim().max(100).nullable(),
  name: z.string().trim().max(240).nullable(),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วย'),
  requestedQuantity: z.number().finite().positive('จำนวนที่ขอต้องมากกว่า 0'),
  unitPrice: moneySchema,
}).strict()

const serviceChecklistSchema = z.object({
  attachments: z.array(z.object({
    kind: z.enum(SERVICE_ATTACHMENT_KINDS),
    slot: z.number().int().min(1).max(3),
    uploadId: z.string().uuid().nullable(),
  }).strict()),
  committees: z.array(z.object({
    kind: z.enum(SERVICE_COMMITTEE_KINDS),
    seat: z.number().int().min(1).max(3),
    profileId: z.string().uuid(),
  }).strict()),
}).strict()

const fiscalMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'กรุณาเลือกเดือนที่ถูกต้อง')

export const servicePurchaseRequestInputSchema = z
  .object({
    department: z.string().trim().min(1, 'กรุณาระบุหน่วยงานผู้ขอ'),
    requesterName: z.string().trim().min(1, 'กรุณาระบุชื่อผู้ขอ'),
    requestedDate: isoDateSchema,
    note: z.string().trim().max(1000).nullable(),
    planId: z.string().uuid().nullable(),
    method: z.enum(SERVICE_PURCHASE_METHODS),
    amount: moneySchema,
    requestedPoMonth: fiscalMonthSchema.nullable(),
    items: z.array(serviceLineSchema),
    checklist: serviceChecklistSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'annual_items') {
      if (value.items.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'กรุณาเลือกรายการอย่างน้อย 1 รายการ' })
      }
      if (value.requestedPoMonth !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestedPoMonth'], message: 'วิธีซื้อในแผนทั้งปีไม่ต้องระบุเดือนทำ PO' })
      }
      const calculated = value.items.reduce((sum, item) => sum + item.requestedQuantity * item.unitPrice, 0)
      if (Math.round(calculated * 100) !== Math.round(value.amount * 100)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'วงเงินไม่ตรงกับยอดรวมรายการ' })
      }
    }

    if (value.method === 'laboratory_testing') {
      if (value.items.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'วิธีจ้างตรวจทางห้องปฏิบัติการไม่ต้องเลือกรายการ' })
      }
      if (!value.requestedPoMonth) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestedPoMonth'], message: 'กรุณาเลือกเดือนที่ขอทำ PO' })
      }
      if (value.amount <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'กรุณาระบุวงเงิน' })
      }
    }
  })

export const servicePurchaseRequestHeaderSchema = z.object({
  department: z.string().trim().min(1, 'กรุณาระบุหน่วยงานผู้ขอ'),
  requestedDate: isoDateSchema,
  note: z.string().trim().max(1000).nullable(),
}).strict()

export const serviceUsageInputSchema = z.object({
  requestId: z.string().uuid(),
  usageDate: isoDateSchema,
  items: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().finite().positive() }).strict()).min(1),
  note: z.string().trim().max(1000).nullable(),
}).strict()

export const serviceLabExpenseInputSchema = z.object({
  requestId: z.string().uuid(),
  expenseDate: isoDateSchema,
  amount: moneySchema.refine((value) => value > 0, 'ยอดค่าใช้จ่ายต้องมากกว่า 0'),
  note: z.string().trim().max(1000).nullable(),
}).strict()

export const serviceLabExpenseAdjustmentSchema = z.object({
  requestId: z.string().uuid(),
  sourceEventId: z.string().uuid(),
  expenseDate: isoDateSchema,
  amount: signedMoneySchema.refine((value) => value !== 0, 'ยอดปรับต้องไม่เป็น 0'),
  note: z.string().trim().min(1, 'กรุณาระบุเหตุผลการปรับยอด').max(1000),
}).strict()

export const serviceCancellationSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ยกเลิก PO').max(1000),
}).strict()

export const serviceClosePoSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().max(1000).nullable(),
}).strict()

export type ServicePlanInput = z.infer<typeof servicePlanInputSchema>
export type ServicePurchaseRequestInput = z.infer<typeof servicePurchaseRequestInputSchema>
export type ServiceUsageInput = z.infer<typeof serviceUsageInputSchema>
export type ServiceLabExpenseInput = z.infer<typeof serviceLabExpenseInputSchema>

export interface ServiceChecklistAttachmentRequirement {
  kind: ServiceAttachmentKind
  slot: number
  label: string
  accept: readonly string[]
}

export interface ServiceChecklistCommitteeRequirement {
  kind: ServiceCommitteeKind
  seats: number
  label: string
}

export interface ServiceChecklistPolicy {
  version: 1
  method: ServicePurchaseMethod
  attachments: ServiceChecklistAttachmentRequirement[]
  committees: ServiceChecklistCommitteeRequirement[]
}

const PDF = ['application/pdf'] as const
const PDF_OR_IMAGE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

export function deriveServiceChecklist(method: ServicePurchaseMethod, amount: number): ServiceChecklistPolicy {
  const quoteCount = amount >= 50_000 ? 3 : 1
  const committeeSeats = amount >= 100_000 ? 3 : 1
  return {
    version: 1,
    method,
    attachments: [
      { kind: 'tor', slot: 1, label: 'รายละเอียดคุณลักษณะเฉพาะ (TOR)', accept: PDF },
      ...Array.from({ length: quoteCount }, (_, index) => ({
        kind: 'quotation' as const,
        slot: index + 1,
        label: `ใบเสนอราคาบริษัทที่ ${index + 1}`,
        accept: PDF_OR_IMAGE,
      })),
    ],
    committees: [
      { kind: 'specification', seats: committeeSeats, label: 'คณะกรรมการกำหนดราคากลางและคุณลักษณะเฉพาะ' },
      { kind: 'inspection', seats: committeeSeats, label: 'คณะกรรมการตรวจรับพัสดุ' },
    ],
  }
}

export function validateServiceCommitteeAssignments(
  policy: ServiceChecklistPolicy,
  assignments: readonly { kind: ServiceCommitteeKind; seat: number; profileId: string }[],
): string[] {
  const errors: string[] = []
  for (const requirement of policy.committees) {
    const rows = assignments.filter((row) => row.kind === requirement.kind)
    const ids = rows.map((row) => row.profileId)
    const seats = rows.map((row) => row.seat).sort((a, b) => a - b)
    if (rows.length !== requirement.seats || seats.some((seat, index) => seat !== index + 1)) {
      errors.push(`${requirement.label} ต้องมี ${requirement.seats} คน`)
    }
    if (new Set(ids).size !== ids.length) errors.push(`${requirement.label} ห้ามเลือกบุคคลซ้ำภายในชุดเดียวกัน`)
  }
  const allowed = new Set(policy.committees.map((row) => row.kind))
  if (assignments.some((row) => !allowed.has(row.kind))) errors.push('พบชุดกรรมการที่ไม่ตรงกับวิธีจัดซื้อ')
  return [...new Set(errors)]
}
