import type { z } from 'zod'
import type { LotExpiryStatus, MovementType, StockLevel } from './balance'
import type {
  inventoryFiltersSchema,
  minimumStockInputSchema,
  stockAdjustmentInputSchema,
} from './schema'

export type MinimumStockInput = z.infer<typeof minimumStockInputSchema>
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>
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
