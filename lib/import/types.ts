export interface SourceCoordinate {
  spreadsheetId: string
  tab: string
  row: number
  cells?: Record<string, string>
}

export interface RawContractRow {
  contractNumber?: unknown
  displayName?: unknown
  vendor?: unknown
  fiscalYear?: unknown
  contractType?: unknown
  product?: unknown
  startDate?: unknown
  endDate?: unknown
  source: SourceCoordinate
}

export interface RawItemRow {
  contractNumber?: unknown
  lsCode?: unknown
  name?: unknown
  unit?: unknown
  quantity?: unknown
  unitPrice?: unknown
  stockOnHand?: unknown
  purchaseSequences?: Record<string, unknown>
  source: SourceCoordinate
}

export interface Workbook<T> {
  spreadsheetId: string
  tab: string
  rows: T[]
}

export interface WorkbookSnapshot {
  contracts: Workbook<RawContractRow>
  items: Workbook<RawItemRow>
}

export type ImportConflictKind = 'contract_identity' | 'name_variant' | 'unit_variant'
export type ImportWarningKind =
  | 'broken_stock_formula'
  | 'ignored_row'
  | 'invalid_contract'
  | 'invalid_item'
  | 'unmatched_contract'

export interface PlannedContract {
  contractNumber: string
  identityKey: string
  displayName: string
  vendor: string
  fiscalYear: number
  contractType: string
  product: string
  startDate: string
  endDate: string
  source: SourceCoordinate
}

export interface PlannedContractItem {
  contractNumber: string
  lineNumber: number
  lsCode: string
  name: string
  unit: string
  quantity: number
  unitPrice: number
  source: SourceCoordinate
}

export interface PlannedInventoryItem {
  lsCode: string
  name: string
  unit: string
  defaultUnitPrice: number | null
  source: SourceCoordinate
}

export interface PlannedAlias {
  lsCode: string
  kind: 'name' | 'unit' | 'ls_code'
  value: string
  source: SourceCoordinate
}

export interface PlannedLegacyAllocation {
  contractNumber: string
  lsCode: string
  sequence: number
  quantity: number
  sourceIdentity: string
  source: SourceCoordinate
}

export interface ImportConflict {
  kind: ImportConflictKind
  key: string
  canonicalValue: string
  variantValue: string
  sources: SourceCoordinate[]
}

export interface ImportWarning {
  kind: ImportWarningKind
  message: string
  source: SourceCoordinate
}

export interface ImportCounts {
  contractNumbers: number
  itemRows: number
  uniqueLsCodes: number
  legacyAllocations: number
}

export interface ImportPlan {
  version: 1
  contracts: PlannedContract[]
  contractItems: PlannedContractItem[]
  inventoryItems: PlannedInventoryItem[]
  aliases: PlannedAlias[]
  legacyAllocations: PlannedLegacyAllocation[]
  conflicts: ImportConflict[]
  warnings: ImportWarning[]
  counts: ImportCounts
}

export type ImportBaseline = Pick<ImportCounts, 'contractNumbers' | 'itemRows' | 'uniqueLsCodes'>

export interface ComparisonWarning {
  metric: keyof ImportBaseline
  expected: number
  actual: number
}

export interface ReconciliationReport {
  version: 1
  counts: ImportCounts
  totals: {
    contractValue: number
    legacyAllocatedQuantity: number
  }
  conflicts: ImportConflict[]
  aliases: PlannedAlias[]
  warnings: ImportWarning[]
  comparisonWarnings: ComparisonWarning[]
  sourceCoordinates: SourceCoordinate[]
}

export interface ApplyImportOptions {
  approvedReportHash?: string
  actorId?: string
  report?: ReconciliationReport
  apply?: (
    plan: ImportPlan,
    context: { actorId: string; reportHash: string },
  ) => Promise<{ importRunId: string }>
}
