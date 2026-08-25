import type { AnnualPlanType } from './schema'

export interface AnnualPlanRecord {
  id: string
  fiscalYear: number
  planType: AnnualPlanType
  fileName: string
  fileSize: number
  mimeType: string
  uploadedBy: string
  uploadedByName: string | null
  uploadedAt: string
}

export interface AnnualPlanStoredRecord extends AnnualPlanRecord {
  filePath: string
}

export interface AnnualPlanSlot {
  fiscalYear: number
  planType: AnnualPlanType
  plan: AnnualPlanRecord | null
}

export interface AnnualPlanYearGroup {
  fiscalYear: number
  slots: [AnnualPlanSlot, AnnualPlanSlot]
}

export type AnnualPlanGroup = AnnualPlanYearGroup
