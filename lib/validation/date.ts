import { z } from 'zod'

/**
 * Calendar-aware ISO date validation. A regex alone accepts 2026-02-31, which
 * Postgres would then reject at insert time with an untranslatable error.
 */
export const isoDateSchema = z
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
