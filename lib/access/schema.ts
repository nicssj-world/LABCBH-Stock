import { z } from 'zod'

export const LAB_STOCK_ROLES = ['admin', 'head', 'stock_officer', 'viewer'] as const

export const membershipInputSchema = z
  .object({
    profileId: z.string().uuid(),
    role: z.enum(LAB_STOCK_ROLES),
    active: z.boolean(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export type MembershipInput = z.infer<typeof membershipInputSchema>
