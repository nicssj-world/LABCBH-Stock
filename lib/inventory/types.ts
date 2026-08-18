import type { z } from 'zod'
import type { LotExpiryStatus, MovementType, StockLevel } from './balance'
import type {
  createInventoryItemInputSchema,
  inventoryFiltersSchema,
  inventoryMinimumStockSettingsInputSchema,
  minimumStockInputSchema,
  setInventoryItemActiveInputSchema,
  stockBalanceInputSchema,
  stockAdjustmentInputSchema,
  updateInventoryItemInputSchema,
} from './schema'

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemInputSchema>
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemInputSchema>
export type SetInventoryItemActiveInput = z.infer<typeof setInventoryItemActiveInputSchema>
export type MinimumStockInput = z.infer<typeof minimumStockInputSchema>
export type InventoryMinimumStockSettingsInput = z.infer<typeof inventoryMinimumStockSettingsInputSchema>
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>
export type StockBalanceInput = z.infer<typeof stockBalanceInputSchema>
export type InventoryFilters = z.infer<typeof inventoryFiltersSchema>

export type AliasKind = 'name' | 'unit' | 'ls_code'

export interface InventoryAliasRecord {
  id: string
  aliasKind: AliasKind
  aliasValue: string
  source: string
}

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

export interface InventoryItemRecord {
  id: string
  lsCode: string
  name: string
  baseUnit: string
  responsibleDepartment: string | null
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
  monthlyIssues: number[]
}

export interface InventoryItemDetail extends InventoryItemRecord {
  note: string | null
  aliases: InventoryAliasRecord[]
  lots: InventoryLotRecord[]
  recentMovements: StockMovementRecord[]
}
