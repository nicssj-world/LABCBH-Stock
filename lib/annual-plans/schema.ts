import { z } from 'zod'

export const ANNUAL_PLAN_TYPES = ['procurement', 'hiring'] as const

export type AnnualPlanType = (typeof ANNUAL_PLAN_TYPES)[number]

export const annualPlanInputSchema = z
  .object({
    fiscalYear: z.number().int().min(2500).max(3000),
    planType: z.enum(ANNUAL_PLAN_TYPES),
  })
  .strict()
