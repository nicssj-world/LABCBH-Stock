/**
 * On-hand and lot balances are always summed from `stock_movements`. No column
 * anywhere is an authoritative balance, so every rule in this module works on
 * ledger rows rather than stored totals.
 */

export const MOVEMENT_TYPES = [
  'goods_receipt',
  'requisition_issue',
  'opening_adjustment',
  'manual_adjustment',
  'reversal',
] as const

export type MovementType = (typeof MOVEMENT_TYPES)[number]

export type StockLevel = 'depleted' | 'below_minimum' | 'healthy'
export type LotExpiryStatus = 'expired' | 'near_expiry' | 'usable'

/** Months of cover behind the suggested minimum, per the approved specification. */
export const DEFAULT_MINIMUM_STOCK_MONTHS = 1.5

/** Months of issuance history the rolling average considers. */
export const MINIMUM_STOCK_WINDOW_MONTHS = 3

/** Days before expiry a lot starts showing on the watchlist. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 90

const QUANTITY_SCALE = 1000

/** Snaps a computed quantity to the `numeric(15,3)` precision the ledger stores. */
export function roundQuantity(value: number): number {
  return Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE
}

export function sumMovementQuantities(movements: Array<{ quantity: number }>): number {
  return roundQuantity(movements.reduce((total, movement) => total + movement.quantity, 0))
}

/**
 * Suggested minimum = rolling average monthly issuance over the last three
 * completed months, multiplied by the item's month cover.
 */
export function calculateSuggestedMinimum(
  monthlyIssues: number[],
  months: number = DEFAULT_MINIMUM_STOCK_MONTHS,
): number {
  const completed = monthlyIssues.slice(-MINIMUM_STOCK_WINDOW_MONTHS)
  if (completed.length === 0) return 0
  const average = completed.reduce((total, value) => total + value, 0) / completed.length
  return roundQuantity(average * months)
}

/** An explicit override always wins, including a deliberate zero. */
export function resolveMinimumStock(explicit: number | null, suggested: number): number {
  return explicit ?? suggested
}

const MOVEMENT_SIGN_RULES: Record<MovementType, (quantity: number) => boolean> = {
  goods_receipt: (quantity) => quantity > 0,
  requisition_issue: (quantity) => quantity < 0,
  opening_adjustment: (quantity) => quantity > 0,
  manual_adjustment: (quantity) => quantity !== 0,
  reversal: (quantity) => quantity !== 0,
}

export function isMovementQuantityValid(type: MovementType, quantity: number): boolean {
  if (!Number.isFinite(quantity)) return false
  return MOVEMENT_SIGN_RULES[type](quantity)
}

/** Reaching the minimum exactly already warrants a PR, so it is not "healthy". */
export function classifyStockLevel({
  onHand,
  minimum,
}: {
  onHand: number
  minimum: number
}): StockLevel {
  if (onHand <= 0) return 'depleted'
  if (minimum <= 0) return 'healthy'
  return onHand <= minimum ? 'below_minimum' : 'healthy'
}

/**
 * What the restock worklist should say about an item, or null when it does not
 * belong on the list at all. Deliberately narrower than classifyStockLevel,
 * which describes the item's state; this answers whether anyone should act.
 *
 * Two exclusions, both measured against production on 2026-08-21, where the
 * unfiltered count was 117 of 172 active items:
 *
 *   - An item with no ledger history at all is a catalogue row carried over
 *     from the old Google Sheet, not a stock-out. 115 of those 117 were this.
 *     An explicit minimum override overrides the exclusion: somebody stating a
 *     reserve level for an item is stating they intend to stock it.
 *   - An item already covered by a draft or pending purchase request has had
 *     the action taken. Counting it again means the number cannot fall when
 *     the work is done, only when the goods arrive.
 */
export function classifyStockAlert({
  stockLevel,
  hasMovements,
  hasOpenRequest,
  minimumStockOverride,
}: {
  stockLevel: StockLevel
  hasMovements: boolean
  hasOpenRequest: boolean
  minimumStockOverride: number | null
}): Exclude<StockLevel, 'healthy'> | null {
  if (stockLevel === 'healthy') return null
  if (hasOpenRequest) return null
  if (!hasMovements && !(minimumStockOverride !== null && minimumStockOverride > 0)) return null
  return stockLevel
}

export function isProjectedBelowMinimum({
  onHand,
  minimum,
  issueQuantity,
}: {
  onHand: number
  minimum: number
  issueQuantity: number
}): boolean {
  const projected = roundQuantity(onHand - issueQuantity)
  return classifyStockLevel({ onHand: projected, minimum }) !== 'healthy'
}

const MILLISECONDS_PER_DAY = 86_400_000

function toUtcDay(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/**
 * A lot expiring today is already unusable — issuing it would hand the ward a
 * reagent that expires before it is opened.
 */
export function classifyLotExpiry(
  expiryDate: string | null,
  today: string,
  warningDays: number = DEFAULT_EXPIRY_WARNING_DAYS,
): LotExpiryStatus {
  if (!expiryDate) return 'usable'
  const daysUntilExpiry = (toUtcDay(expiryDate) - toUtcDay(today)) / MILLISECONDS_PER_DAY
  if (daysUntilExpiry <= 0) return 'expired'
  return daysUntilExpiry <= warningDays ? 'near_expiry' : 'usable'
}
