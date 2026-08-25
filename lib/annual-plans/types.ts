import type { AnnualPlanType } from './schema'

export interface AnnualPlanRecord {
  id: string
  fiscalYear: number
  planType: AnnualPlanType
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  uploadedBy: string
  uploadedAt: string
}

export interface AnnualPlanGroup {
  fiscalYear: number
  procurement: AnnualPlanRecord | null
  hiring: AnnualPlanRecord | null
}
