import type { z } from 'zod'
import type {
  CONTRACT_TYPES,
  archiveContractInputSchema,
  contractInputSchema,
  contractItemUpdateInputSchema,
  contractLineInputSchema,
  createContractInputSchema,
  stageAdvanceSchema,
  updateContractInputSchema,
} from './schema'
import type { ProcurementStage } from './stages'

export type ContractType = (typeof CONTRACT_TYPES)[number]
export type ContractInput = z.infer<typeof contractInputSchema>
export type ContractLineInput = z.infer<typeof contractLineInputSchema>
export type ContractItemUpdateInput = z.infer<typeof contractItemUpdateInputSchema>
export type CreateContractInput = z.infer<typeof createContractInputSchema>
export type UpdateContractInput = z.infer<typeof updateContractInputSchema>
export type ArchiveContractInput = z.infer<typeof archiveContractInputSchema>
export type StageAdvanceInput = z.infer<typeof stageAdvanceSchema>
export type ContractStatus = 'active' | 'expired' | 'cancelled' | 'pending'

export interface ContractItemRecord {
  id: string
  lineNumber: number
  lsCode: string
  name: string
  quantity: number
  unit: string
  unitPrice: number
  lineTotal: number
}

export interface ContractStageHistoryRecord {
  id: string
  fromStage: ProcurementStage | null
  toStage: ProcurementStage
  effectiveDate: string
  contractNumberSnapshot: string | null
  note: string | null
  source: string
  actorId: string | null
  createdAt: string
}

export interface ContractRecord {
  id: number
  product: string
  fiscalYear: number | null
  contractType: ContractType | null
  procurementStage: ProcurementStage | null
  status: ContractStatus | null
  displayName: string | null
  contractNumber: string | null
  vendor: string | null
  startDate: string | null
  endDate: string | null
  updatedAt: string | null
  isArchived: boolean | null
  items: ContractItemRecord[]
  stageHistory: ContractStageHistoryRecord[]
}
