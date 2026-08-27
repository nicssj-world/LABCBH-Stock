import type { z } from 'zod'
import type { LotExpiryStatus, MovementType, StockLevel } from './balance'
import type {
  createInventoryItemInputSchema,
  inventoryExportFiltersSchema,
  inventoryFiltersSchema,
  inventoryMinimumStockSettingsInputSchema,
  minimumStockInputSchema,
  setInventoryItemActiveInputSchema,
  setInventoryLotActiveInputSchema,
  stockBalanceInputSchema,
  stockAdjustmentInputSchema,
  updateInventoryItemInputSchema,
} from './schema'

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemInputSchema>
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemInputSchema>
export type SetInventoryItemActiveInput = z.infer<typeof setInventoryItemActiveInputSchema>
export type SetInventoryLotActiveInput = z.infer<typeof setInventoryLotActiveInputSchema>
export type MinimumStockInput = z.infer<typeof minimumStockInputSchema>
export type InventoryMinimumStockSettingsInput = z.infer<typeof inventoryMinimumStockSettingsInputSchema>
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>
export type StockBalanceInput = z.infer<typeof stockBalanceInputSchema>
export type InventoryFilters = z.infer<typeof inventoryFiltersSchema>
export type InventoryExportFilters = z.infer<typeof inventoryExportFiltersSchema>

export interface InventoryLotRecord {
  id: string
  lotNumber: string
  expiryDate: string | null
  /** Alias of receivedDate, so the record satisfies the FIFO ranking contract. */
  receivedAt: string
  receivedDate: string
  originalQuantity: number
  storageLocation: string | null
  balance: number
  isActive: boolean
  expiryStatus: LotExpiryStatus
}

export interface StockMovementRecord {
  id: string
  movementType: MovementType
  quantity: number
  occurredOn: string
  lotNumber: string | null
  note: string | null
  createdAt: string
}

export interface InventoryMovementPagination {
  currentPage: number
  pageCount: number
  totalCount: number
  pageSize: number
  startIndex: number
}

/**
 * The identifying fields of an active catalogue item, for the pickers that
 * only ever offer a choice — contract lines, receipt lines. Deliberately
 * separate from InventoryItemRecord: resolving on-hand and a suggested
 * minimum costs three further reads that a picker never displays.
 */
export interface InventoryCatalogEntry {
  id: string
  lsCode: string
  name: string
  baseUnit: string
}

export interface InventoryItemRecord {
  id: string
  lsCode: string
  name: string
  baseUnit: string
  responsibleDepartment: string | null
  note: string | null
  defaultUnitPrice: number | null
  minimumStockMonths: number
  minimumStockOverride: number | null
  isActive: boolean
  /** Summed from the ledger; never read from a stored column. */
  onHand: number
  /** Rolling three-month average issuance multiplied by the month cover. */
  suggestedMinimum: number
  /** The override when set, otherwise the suggested value. */
  minimumStock: number
  stockLevel: StockLevel
  /** False for a catalogue row that has never been received or issued. */
  hasMovements: boolean
  /** True while a draft or pending purchase request already covers this item. */
  hasOpenRequest: boolean
  monthlyIssues: number[]
  /** The latest physical stock-check stamp, retained across weekly resets. */
  lastStockCheckedAt: string | null
  /** Whether the latest stamp belongs to the current Bangkok business week. */
  isStockCheckedThisWeek: boolean
}

export interface InventoryItemDetail extends InventoryItemRecord {
  lots: InventoryLotRecord[]
  recentMovements: StockMovementRecord[]
  movementPagination: InventoryMovementPagination
}

export type InventoryItemSummary = Pick<
  InventoryItemDetail,
  | 'id'
  | 'lsCode'
  | 'name'
  | 'baseUnit'
  | 'responsibleDepartment'
  | 'note'
  | 'defaultUnitPrice'
  | 'isActive'
  | 'onHand'
  | 'minimumStock'
  | 'stockLevel'
  | 'lastStockCheckedAt'
  | 'isStockCheckedThisWeek'
  | 'lots'
>

export interface InventoryStockCheckResult {
  id: string
  checkedAt: string
  weekStart: string
}

export interface InventoryLotStockCheckResult extends InventoryStockCheckResult {
  inventoryLotId: string
}

export interface InventoryChecklistLotRecord extends InventoryLotRecord {
  /** The latest physical-check stamp for this lot, retained across weeks. */
  lastStockCheckedAt: string | null
  /** Whether the latest lot check belongs to the current Bangkok business week. */
  isStockCheckedThisWeek: boolean
}

export interface InventoryChecklistItemRecord extends InventoryItemRecord {
  /** Active lots with a positive balance that must be checked for this item. */
  checklistLots: InventoryChecklistLotRecord[]
}

export interface InventoryExportLotRecord {
  id: string
  lotNumber: string
  expiryDate: string | null
  balance: number
  isActive: boolean
}

export interface InventoryExportItemRecord {
  id: string
  lsCode: string
  name: string
  baseUnit: string
  responsibleDepartment: string | null
  note: string | null
  onHand: number
  lots: InventoryExportLotRecord[]
}
