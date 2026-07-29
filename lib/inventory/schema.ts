import { z } from 'zod'
import { isoDateSchema } from '@/lib/validation/date'
import { MOVEMENT_TYPES } from './balance'

export const MOVEMENT_TYPE_ENUM = z.enum(MOVEMENT_TYPES)

export const minimumStockInputSchema = z
  .object({
    // Null clears the override and hands the item back to the suggested value.
    minimumStockOverride: z
      .number()
      .finite()
      .min(0, 'ค่าขั้นต่ำต้องไม่ติดลบ')
      .nullable(),
    minimumStockMonths: z
      .number()
      .finite()
      .positive('จำนวนเดือนสำรองต้องมากกว่า 0')
      .max(60, 'จำนวนเดือนสำรองต้องไม่เกิน 60'),
    reason: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()

export const stockAdjustmentInputSchema = z
  .object({
    inventoryLotId: z.string().uuid().nullable(),
    quantity: z
      .number()
      .finite()
      .refine((value) => value !== 0, 'จำนวนที่ปรับต้องไม่เป็นศูนย์'),
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลในการปรับยอด'),
    occurredOn: isoDateSchema.nullable().optional(),
  })
  .strict()

export const inventoryFiltersSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    department: z.string().trim().max(200).optional(),
    includeInactive: z.boolean().optional(),
  })
  .strict()
