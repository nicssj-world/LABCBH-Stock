import type { z } from 'zod'
import type {
  OUT_LAB_CADENCES,
  OUT_LAB_DEPARTMENTS,
  OUT_LAB_KINDS,
  outLabArchiveInputSchema,
  outLabCreateInputSchema,
  outLabExpireInputSchema,
  outLabResponsibleUsersInputSchema,
  outLabStageAdvanceSchema,
  outLabUpdateInputSchema,
  outLabUsageInputSchema,
} from '@/lib/out-lab/schema'
import type { ProcurementStage } from '@/lib/contracts/stages'

export type OutLabKind = (typeof OUT_LAB_KINDS)[number]
export type OutLabCadence = (typeof OUT_LAB_CADENCES)[number]
export type OutLabDepartment = (typeof OUT_LAB_DEPARTMENTS)[number]
export type OutLabStatus = 'pending' | 'active' | 'expired' | 'cancelled'

export type OutLabCreateInput = z.infer<typeof outLabCreateInputSchema>
export type OutLabUpdateInput = z.infer<typeof outLabUpdateInputSchema>
export type OutLabUsageInput = z.infer<typeof outLabUsageInputSchema>
export type OutLabResponsibleUsersInput = z.infer<typeof outLabResponsibleUsersInputSchema>
export type OutLabStageAdvanceInput = z.infer<typeof outLabStageAdvanceSchema>
export type OutLabArchiveInput = z.infer<typeof outLabArchiveInputSchema>
export type OutLabExpireInput = z.infer<typeof outLabExpireInputSchema>

export interface OutLabUsageRecord {
  id: string
  usageMonth: string
  amount: number
  note: string | null
  recordedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface OutLabStageHistoryRecord {
  id: string
  fromStage: ProcurementStage | null
  toStage: ProcurementStage
  effectiveDate: string
  contractNumberSnapshot: string | null
  note: string | null
  source: string
  createdAt: string
}

export interface OutLabContractRecord {
  id: string
  kind: OutLabKind
  entryCadence: OutLabCadence
  fiscalYear: number
  displayName: string
  vendor: string | null
  department: OutLabDepartment | null
  contractNumber: string | null
  /** Contract value for a ceiling row, planned budget for an annual plan. */
  total: number | null
  startDate: string
  endDate: string
  procurementStage: ProcurementStage | null
  status: OutLabStatus
  isArchived: boolean
  archiveReason: string | null
  responsibleUserIds: string[]
  fileUrl: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  stageHistory: OutLabStageHistoryRecord[]
}

/**
 * Register rows carry their balance and their overdue-period count already
 * computed, so the list renders from one read instead of one per row.
 */
export interface OutLabContractListRecord extends OutLabContractRecord {
  used: number
  remaining: number | null
  remainingPercent: number | null
  missingPeriodCount: number
}
