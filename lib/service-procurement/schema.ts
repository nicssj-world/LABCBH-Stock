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

export const SERVICE_PURCHASE_METHODS = ['laboratory_testing'] as const
export type ServicePurchaseMethod = (typeof SERVICE_PURCHASE_METHODS)[number]
type DeprecatedServicePurchaseMethod = ServicePurchaseMethod | 'annual_items'

export const SERVICE_PR_STATUSES = ['pending', 'confirmed', 'closed', 'cancelled'] as const
export type ServicePrStatus = (typeof SERVICE_PR_STATUSES)[number]

export const SERVICE_PO_STATUSES = ['not_issued', 'open', 'closed', 'cancelled'] as const
export type ServicePoStatus = (typeof SERVICE_PO_STATUSES)[number]

export const SERVICE_PLAN_STATUSES = ['active', 'closing', 'closed'] as const
export type ServicePlanStatus = (typeof SERVICE_PLAN_STATUSES)[number]

export const SERVICE_EXPENSE_FREQUENCIES = ['monthly', 'daily'] as const
export type ServiceExpenseFrequency = (typeof SERVICE_EXPENSE_FREQUENCIES)[number]

export const SERVICE_FULFILLMENT_STATUSES = ['not_started', 'partial', 'complete'] as const
export type ServiceFulfillmentStatus = (typeof SERVICE_FULFILLMENT_STATUSES)[number]

export const SERVICE_ATTACHMENT_KINDS = ['tor', 'quotation'] as const
export type ServiceAttachmentKind = (typeof SERVICE_ATTACHMENT_KINDS)[number]

export const SERVICE_PLAN_DOCUMENT_KINDS = ['quotation', 'contract_page'] as const
export type ServicePlanDocumentKind = (typeof SERVICE_PLAN_DOCUMENT_KINDS)[number]

export const SERVICE_COMMITTEE_KINDS = ['specification', 'inspection'] as const
export type ServiceCommitteeKind = (typeof SERVICE_COMMITTEE_KINDS)[number]

const moneySchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => Math.round(value * 100) === value * 100, 'จำนวนเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง')
const responsibleIdsSchema = z.array(z.string().uuid()).max(20).refine((ids) => new Set(ids).size === ids.length, 'ผู้รับผิดชอบห้ามซ้ำกัน')
const planTestItemSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาระบุชื่อรายการส่งตรวจ').max(240),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วย').max(100),
  unitPrice: moneySchema.refine((value) => value > 0, 'ราคาต่อหน่วยต้องมากกว่า 0'),
}).strict()

const servicePlanFields = z.object({
    fiscalYear: z.number().int().min(2500).max(3000),
    name: z.string().trim().min(1, 'กรุณาระบุชื่อแผน').max(240),
    department: z.enum(DEPARTMENTS, { errorMap: () => ({ message: 'กรุณาเลือกหน่วยงาน' }) }),
    budget: moneySchema.refine((value) => value > 0, 'วงเงินต้องมากกว่า 0'),
    type: z.enum(SERVICE_PLAN_TYPES),
    isRedCross: z.boolean().default(false),
    requiresContract: z.boolean().default(false),
    testItems: z.array(planTestItemSchema).max(200).default([]),
    responsibleProfileIds: responsibleIdsSchema,
}).strict()

export const servicePlanInputSchema = servicePlanFields.superRefine((value, ctx) => {
    if (!value.isRedCross && value.testItems.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['testItems'], message: 'รายการส่งตรวจใช้ได้เฉพาะแผนสภากาชาดไทย' })
    }
    const duplicate = new Set<string>()
    value.testItems.forEach((item, index) => {
      const key = `${item.name.toLocaleLowerCase()}|${item.unit.toLocaleLowerCase()}`
      if (duplicate.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['testItems', index, 'name'], message: 'มีรายการส่งตรวจซ้ำกัน' })
      duplicate.add(key)
    })
})

export const servicePlanUpdateSchema = servicePlanFields.extend({
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((value, ctx) => {
  if (!value.isRedCross && value.testItems.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['testItems'], message: 'รายการส่งตรวจใช้ได้เฉพาะแผนสภากาชาดไทย' })
  const keys = new Set<string>()
  value.testItems.forEach((item, index) => {
    const key = `${item.name.toLocaleLowerCase()}|${item.unit.toLocaleLowerCase()}`
    if (keys.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['testItems', index, 'name'], message: 'มีรายการส่งตรวจซ้ำกัน' })
    keys.add(key)
  })
})

export const servicePlanBudgetRevisionSchema = z
  .object({
    planId: z.string().uuid(),
    budget: moneySchema.refine((value) => value > 0, 'วงเงินต้องมากกว่า 0'),
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(1000),
  })
  .strict()

/** Retained only for compatibility with old service data; the new UI never writes it. */
export const servicePlanHistoricalExpenseSchema = z
  .object({
    planId: z.string().uuid(),
    amount: moneySchema.refine((value) => value > 0, 'ยอดค่าใช้จ่ายต้องมากกว่า 0'),
    expenseDate: isoDateSchema,
    reason: z.string().trim().max(1000).nullable().optional(),
    sourceReference: z.string().trim().min(1, 'กรุณาระบุแหล่งอ้างอิง').max(240),
  })
  .strict()

export const servicePlanExpenseAdjustmentSchema = z
  .object({
    planId: z.string().uuid(),
    amount: z.number().finite().refine((value) => value !== 0, 'ยอดปรับต้องไม่เป็น 0'),
    expenseDate: isoDateSchema,
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(1000),
    sourceReference: z.string().trim().min(1, 'กรุณาระบุแหล่งอ้างอิง').max(240),
    sourceLedgerId: z.string().uuid().nullable(),
  })
  .strict()

const serviceLineSchema = z.object({
  planItemId: z.string().uuid(),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อรายการ').max(240),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วย').max(100),
  unitPrice: moneySchema.refine((value) => value > 0, 'ราคาต่อหน่วยต้องมากกว่า 0'),
  requestedQuantity: z.number().finite().nonnegative('จำนวนต้องไม่ติดลบ'),
}).strict()

const serviceChecklistSchema = z.object({
  attachments: z.array(z.object({
    kind: z.literal('tor'),
    slot: z.literal(1),
    uploadId: z.string().uuid().nullable(),
  }).strict()),
  committees: z.array(z.object({
    kind: z.enum(SERVICE_COMMITTEE_KINDS),
    seat: z.number().int().min(1).max(3),
    profileId: z.string().uuid(),
  }).strict()),
}).strict()

const documentChoicesSchema = z.object({
  replaceQuotation: z.boolean().default(false),
  replaceContractPage: z.boolean().default(false),
}).strict().default({})

export const servicePurchaseRequestInputSchema = z
  .object({
    department: z.string().trim().min(1, 'กรุณาระบุหน่วยงานผู้ขอ'),
    requesterName: z.string().trim().min(1, 'กรุณาระบุชื่อผู้ขอ'),
    requestedDate: isoDateSchema,
    note: z.string().trim().max(1000).nullable(),
    planId: z.string().uuid(),
    /** Rejected below; retained only so old saved-form payloads fail with a useful issue. */
    method: z.literal('laboratory_testing').optional(),
    amount: moneySchema.refine((value) => value > 0, 'กรุณาระบุวงเงิน'),
    usageStartDate: isoDateSchema,
    usageEndDate: isoDateSchema,
    items: z.array(serviceLineSchema),
    checklist: serviceChecklistSchema,
    documentChoices: documentChoicesSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['method'], message: 'งานจ้างไม่รับวิธีจัดซื้อจาก client' })
    if (value.usageStartDate >= value.usageEndDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['usageEndDate'], message: 'วันที่สิ้นสุดต้องหลังวันที่เริ่มต้น' })
    }
  })

export const servicePurchaseRequestHeaderSchema = z.object({
  department: z.string().trim().min(1, 'กรุณาระบุหน่วยงานผู้ขอ'),
  requestedDate: isoDateSchema,
  note: z.string().trim().max(1000).nullable(),
}).strict()

export const serviceLabExpenseInputSchema = z.object({
  requestId: z.string().uuid(),
  expenseDate: isoDateSchema,
  amount: moneySchema.refine((value) => value > 0, 'ยอดค่าใช้จ่ายต้องมากกว่า 0'),
  invoiceNumber: z.string().trim().max(240).nullable(),
  note: z.string().trim().max(1000).nullable(),
}).strict()

export const serviceLabExpenseUpdateSchema = serviceLabExpenseInputSchema.extend({
  expenseId: z.string().uuid(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลการแก้ไข').max(1000),
}).strict()

export const serviceLabExpenseCancelSchema = z.object({
  requestId: z.string().uuid(),
  expenseId: z.string().uuid(),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลการยกเลิก').max(1000),
}).strict()

/** Deprecated aliases kept so older server actions compile while the new
 * expense RPCs use the three schemas above. */
export const serviceLabExpenseAdjustmentSchema = z.object({
  requestId: z.string().uuid(),
  sourceEventId: z.string().uuid(),
  expenseDate: isoDateSchema,
  amount: z.number().finite().refine((value) => value !== 0),
  note: z.string().trim().min(1).max(1000),
}).strict()

export const serviceUsageInputSchema = z.object({
  requestId: z.string().uuid(),
  usageDate: isoDateSchema,
  items: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().finite().positive() }).strict()),
  note: z.string().trim().max(1000).nullable(),
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

export function deriveServiceChecklist(method: DeprecatedServicePurchaseMethod, amount: number): ServiceChecklistPolicy {
  const committeeSeats = amount >= 100_000 ? 3 : 1
  return {
    version: 1,
    method: 'laboratory_testing',
    attachments: [
      { kind: 'tor', slot: 1, label: 'รายละเอียดคุณลักษณะเฉพาะ (TOR)', accept: PDF },
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
