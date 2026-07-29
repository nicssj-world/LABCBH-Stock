import type { z } from 'zod'
import type { CONTRACT_TYPES, contractInputSchema, contractLineInputSchema } from './schema'
import type { ProcurementStage } from './stages'

export type ContractType = (typeof CONTRACT_TYPES)[number]
export type ContractInput = z.infer<typeof contractInputSchema>
export type ContractLineInput = z.infer<typeof contractLineInputSchema>

export interface ContractRecord {
  id: number
  fiscalYear: number
  contractType: ContractType
  procurementStage: ProcurementStage
  status: 'active' | 'expired' | 'cancelled' | 'pending'
  displayName: string
  contractNumber: string | null
  vendor: string | null
  startDate: string | null
  endDate: string | null
  isArchived: boolean
}
