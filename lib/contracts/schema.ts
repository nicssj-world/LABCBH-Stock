import { z } from 'zod'
import { PROCUREMENT_STAGES } from './stages'

export const CONTRACT_TYPES = [
  'equipment_lease',
  'e_bidding',
  'annual_specific',
  'specific',
  'off_plan',
  'awaiting_equipment_lease',
  'thai_red_cross',
] as const

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    if (!year || !month || !day) return false
    const parsed = new Date(Date.UTC(year, month - 1, day))
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    )
  }, 'วันที่ไม่ถูกต้อง')

export const contractLineInputSchema = z.object({
  lsCode: z.string().trim().min(1, 'กรุณาระบุรหัสน้ำยา (LS)'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อน้ำยา'),
  quantity: z.number().finite().positive('จำนวนในสัญญาต้องมากกว่า 0'),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วย'),
  unitPrice: z.number().finite().positive('ราคาต่อหน่วยต้องมากกว่า 0'),
})

export const contractInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2500).max(3000),
    contractType: z.enum(CONTRACT_TYPES),
    procurementStage: z.enum(PROCUREMENT_STAGES),
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

    if (value.procurementStage !== 'contract_started' && value.contractNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractNumber'],
        message: 'เลขที่สัญญาจะกำหนดได้เมื่อเริ่มสัญญาเท่านั้น',
      })
    }
  })
