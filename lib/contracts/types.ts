import type { z } from 'zod'
import type {
  CONTRACT_DEPARTMENTS,
  CONTRACT_TYPES,
  archiveContractInputSchema,
  contractExpenseInputSchema,
  contractInputSchema,
  contractItemUpdateInputSchema,
  contractLineInputSchema,
  createContractInputSchema,
  expireContractInputSchema,
  responsibleUsersInputSchema,
  stageAdvanceSchema,
  updateContractInputSchema,
} from './schema'
import type { ProcurementStage } from './stages'

export type ContractType = (typeof CONTRACT_TYPES)[number]
export type ContractDepartment = (typeof CONTRACT_DEPARTMENTS)[number]
export type ContractInput = z.infer<typeof contractInputSchema>
export type ContractLineInput = z.infer<typeof contractLineInputSchema>
export type ContractItemUpdateInput = z.infer<typeof contractItemUpdateInputSchema>
export type CreateContractInput = z.infer<typeof createContractInputSchema>
export type UpdateContractInput = z.infer<typeof updateContractInputSchema>
export type ArchiveContractInput = z.infer<typeof archiveContractInputSchema>
export type ExpireContractInput = z.infer<typeof expireContractInputSchema>
export type StageAdvanceInput = z.infer<typeof stageAdvanceSchema>
export type ContractExpenseInput = z.infer<typeof contractExpenseInputSchema>
export type ResponsibleUsersInput = z.infer<typeof responsibleUsersInputSchema>
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
  department: ContractDepartment | null
  procurementStage: ProcurementStage | null
  status: ContractStatus | null
  displayName: string | null
  contractNumber: string | null
  vendor: string | null
  startDate: string | null
  endDate: string | null
  updatedAt: string | null
  isArchived: boolean | null
  // Budget mode reads these two: the ceiling to measure against, and who may
  // spend against it without holding an editor role.
  total: number | null
  responsibleUserIds: string[]
  fileUrl: string | null
  items: ContractItemRecord[]
  stageHistory: ContractStageHistoryRecord[]
}
