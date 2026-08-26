import { classifyLotExpiry, roundQuantity } from '@/lib/inventory/balance'

export interface FifoLot {
  id: string
  receivedAt: string
  expiryDate: string | null
  balance: number
  /** Inactive lots remain historical records but can never be issued. */
  isActive?: boolean
}

/**
 * Issue order per the approved specification: received date first, then expiry,
 * then the smaller balance so partial lots get drained instead of accumulating.
 * A lot with no expiry sorts last among equals — it is never more urgent than
 * one that will actually go out of date.
 */
export function rankLotsForFifo<T extends FifoLot>(lots: T[]): T[] {
  return [...lots].sort((left, right) => {
    if (left.receivedAt !== right.receivedAt) {
      return left.receivedAt.localeCompare(right.receivedAt)
    }

    const leftExpiry = left.expiryDate ?? '9999-12-31'
    const rightExpiry = right.expiryDate ?? '9999-12-31'
    if (leftExpiry !== rightExpiry) return leftExpiry.localeCompare(rightExpiry)

    if (left.balance !== right.balance) return left.balance - right.balance
    return left.id.localeCompare(right.id)
  })
}

/** Expired or empty lots are never issuable. */
export function isLotSelectable(lot: FifoLot, today: string): boolean {
  if (lot.isActive === false) return false
  if (lot.balance <= 0) return false
  return classifyLotExpiry(lot.expiryDate, today) !== 'expired'
}

/**
 * True when a usable lot before the last selected lot was passed over.
 * Skipping forward is allowed, but every gap before a selected lot has to be
 * explained. Lots after the last selected lot are not a FIFO violation: the
 * request may simply not need them.
 */
export function requiresOverrideReason(
  lots: FifoLot[],
  selectedLotIds: string[],
  today: string,
): boolean {
  if (selectedLotIds.length === 0) return false

  const selectable = rankLotsForFifo(lots.filter((lot) => isLotSelectable(lot, today)))
  const selected = new Set(selectedLotIds)
  const lastSelectedIndex = selectable.reduce(
    (lastIndex, lot, index) => (selected.has(lot.id) ? index : lastIndex),
    -1,
  )

  if (lastSelectedIndex < 0) return false
  return selectable.slice(0, lastSelectedIndex).some((lot) => !selected.has(lot.id))
}

export interface LotAllocationInput {
  lotId: string
  quantity: number
}

export interface RankedSelectableLot {
  id: string
  balance: number
  selectable: boolean
}

/**
 * The lot the officer should take first, pre-filled at the full requested
 * quantity capped to what that lot actually has — saves a click for the
 * common case where one lot covers the request. Empty when nothing is
 * currently selectable. `rankedLots` must already be FIFO-ranked (as
 * listSelectableLots returns them); this does not re-sort.
 */
export function defaultLotSelection(
  rankedLots: RankedSelectableLot[],
  requestedQuantity: number,
): LotAllocationInput[] {
  const topLot = rankedLots.find((lot) => lot.selectable)
  if (!topLot) return []
  return [{ lotId: topLot.id, quantity: roundQuantity(Math.min(topLot.balance, requestedQuantity)) }]
}

/**
 * Front-line validation so the officer sees a named problem instead of a
 * database error. The RPC re-checks all of this under row locks.
 */
export function validateLotAllocations({
  requestedQuantity,
  allocations,
  lotBalances,
}: {
  requestedQuantity: number
  allocations: LotAllocationInput[]
  lotBalances: Map<string, number>
}): string[] {
  const errors: string[] = []

  if (allocations.some((allocation) => allocation.quantity <= 0)) {
    errors.push('จำนวนที่จ่ายของแต่ละล็อตต้องมากกว่า 0')
  }

  const lotIds = allocations.map((allocation) => allocation.lotId)
  if (new Set(lotIds).size !== lotIds.length) {
    errors.push('เลือกล็อตเดียวกันซ้ำ')
  }

  for (const allocation of allocations) {
    const balance = lotBalances.get(allocation.lotId) ?? 0
    if (allocation.quantity > balance) {
      errors.push(`ล็อต ${allocation.lotId} มีคงเหลือ ${balance} ไม่พอจ่าย ${allocation.quantity}`)
    }
  }

  const total = roundQuantity(
    allocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
  )
  if (total !== roundQuantity(requestedQuantity)) {
    errors.push(`จำนวนที่จ่ายรวม ${total} ไม่ตรงกับจำนวนที่ขอเบิก ${requestedQuantity}`)
  }

  return errors
}
