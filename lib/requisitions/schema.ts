import { z } from 'zod'
import { isoDateSchema } from '@/lib/validation/date'

export const REQUISITION_STATUSES = ['waiting', 'fulfilled', 'cancelled'] as const
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number]

export const requisitionLineInputSchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    requestedQuantity: z.number().finite().positive('จำนวนที่ขอเบิกต้องมากกว่า 0'),
    unit: z.string().trim().min(1, 'กรุณาระบุหน่วย'),
    note: z.string().trim().max(500).nullable(),
  })
  .strict()

export const requisitionInputSchema = z
  .object({
    department: z.string().trim().min(1, 'กรุณาระบุหน่วยงานผู้ขอเบิก'),
    requesterName: z.string().trim().min(1, 'กรุณาระบุชื่อผู้ขอเบิก'),
    desiredDate: isoDateSchema,
    note: z.string().trim().max(1000).nullable(),
    items: z.array(requisitionLineInputSchema).min(1, 'ต้องมีรายการขอเบิกอย่างน้อย 1 รายการ'),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.items.map((item) => item.inventoryItemId)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'น้ำยารายการเดียวกันซ้ำกันภายในใบเบิกเดียวกัน',
      })
    }
  })

export const lotAllocationInputSchema = z
  .object({
    requisitionItemId: z.string().uuid(),
    inventoryLotId: z.string().uuid(),
    quantity: z.number().finite().positive('จำนวนที่จ่ายต้องมากกว่า 0'),
    overrideReason: z.string().trim().max(500).nullable(),
  })
  .strict()

export const fulfillRequisitionInputSchema = z
  .object({
    allocations: z.array(lotAllocationInputSchema).min(1, 'ต้องเลือกล็อตอย่างน้อย 1 ล็อต'),
  })
  .strict()
