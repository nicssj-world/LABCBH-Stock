import type { z } from 'zod'
import type {
  CONTRACT_DEPARTMENTS,
  CONTRACT_DURATION_YEARS,
  CONTRACT_TYPES,
  archiveContractInputSchema,
  contractCreateLineInputSchema,
  contractExpenseInputSchema,
  contractInputSchema,
  contractItemUpdateInputSchema,
  contractLineInputSchema,
  contractOpeningBalanceInputSchema,
  createContractInputSchema,
  expireContractInputSchema,
  responsibleUsersInputSchema,
  stageAdvanceSchema,
  stageHistoryBackfillInputSchema,
  stageHistoryCorrectionInputSchema,
  updateContractInputSchema,
} from './schema'
import type { ProcurementStage } from './stages'

export type ContractType = (typeof CONTRACT_TYPES)[number]
export type ContractDepartment = (typeof CONTRACT_DEPARTMENTS)[number]
export type ContractDurationYears = (typeof CONTRACT_DURATION_YEARS)[number]
export type ContractInput = z.infer<typeof contractInputSchema>
export type ContractLineInput = z.infer<typeof contractLineInputSchema>
export type ContractCreateLineInput = z.infer<typeof contractCreateLineInputSchema>
export type ContractItemUpdateInput = z.infer<typeof contractItemUpdateInputSchema>
/**
 * Shared shape for the item-row editor: an existing/new line plus the
 * create-only opening balance field. Empty numeric values are kept blank while
 * the user edits the row and are validated before submission.
 */
export type ContractFormItemInput = Omit<ContractItemUpdateInput, 'quantity' | 'unitPrice'> & {
  quantity: number | ''
  unitPrice: number | ''
  openingUsedQuantity?: number | null
}
export type CreateContractInput = z.infer<typeof createContractInputSchema>
export type UpdateContractInput = z.infer<typeof updateContractInputSchema>
export type ArchiveContractInput = z.infer<typeof archiveContractInputSchema>
export type ExpireContractInput = z.infer<typeof expireContractInputSchema>
export type StageAdvanceInput = z.infer<typeof stageAdvanceSchema>
export type StageHistoryCorrectionInput = z.infer<typeof stageHistoryCorrectionInputSchema>
export type StageHistoryBackfillInput = z.infer<typeof stageHistoryBackfillInputSchema>
export type ContractExpenseInput = z.infer<typeof contractExpenseInputSchema>
export type ResponsibleUsersInput = z.infer<typeof responsibleUsersInputSchema>
export type ContractOpeningBalanceInput = z.infer<typeof contractOpeningBalanceInputSchema>
export type ContractStatus = 'active' | 'expired' | 'cancelled' | 'pending'

export interface ContractOpeningBalanceHistoryLine {
  lsCode: string
  name: string
  previousQuantity: number
  targetQuantity: number
}

/** One call to set_contract_opening_balances (or the create_contract fast path), grouped by its shared transaction timestamp. */
export interface ContractOpeningBalanceHistoryEntry {
  createdAt: string
  effectiveDate: string | null
  note: string
  lines: ContractOpeningBalanceHistoryLine[]
}

export interface ContractItemRecord {
  id: string
  lineNumber: number
  lsCode: string
  name: string
  quantity: number
  unit: string
  unitPrice: number
  lineTotal: number
  /** Committed against the contract so far, across every allocation kind. */
  allocatedQuantity: number
  /** Portion of allocatedQuantity that was used before the contract was registered here. */
  openingUsedQuantity: number
  remainingQuantity: number
  remainingValue: number
  remainingPercent: number
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
  correctedAt: string | null
  correctionReason: string | null
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
  /** Selected on a PR that originates a new contract; null for legacy/direct rows. */
  contractDurationYears: ContractDurationYears | null
  vendor: string | null
  startDate: string | null
  endDate: string | null
  updatedAt: string | null
  isArchived: boolean | null
  archivedAt: string | null
  archiveReason: string | null
  // Budget mode reads these two: the ceiling to measure against, and who may
  // spend against it without holding an editor role.
  total: number | null
  /** Percentage of the contract still available for the register gauge. */
  remainingPercent?: number | null
  responsibleUserIds: string[]
  fileUrl: string | null
  items: ContractItemRecord[]
  stageHistory: ContractStageHistoryRecord[]
}
