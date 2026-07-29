import assert from 'node:assert/strict'
import {
  DEFAULT_MINIMUM_STOCK_MONTHS,
  MOVEMENT_TYPES,
  calculateSuggestedMinimum,
  classifyLotExpiry,
  classifyStockLevel,
  isMovementQuantityValid,
  isProjectedBelowMinimum,
  resolveMinimumStock,
  roundQuantity,
  sumMovementQuantities,
} from '../lib/inventory/balance'
import { normalizeLsCode } from '../lib/inventory/ls-code'

// Suggested minimum is the rolling three-month average issue multiplied by the
// configured month cover, defaulting to 1.5 months.
assert.equal(DEFAULT_MINIMUM_STOCK_MONTHS, 1.5)
assert.equal(calculateSuggestedMinimum([]), 0)
assert.equal(calculateSuggestedMinimum([10, 20, 30]), 30)
assert.equal(calculateSuggestedMinimum([100, 10, 20, 30]), 30, 'only the last three months count')
assert.equal(calculateSuggestedMinimum([10, 20]), 22.5, 'a short history still averages what exists')
assert.equal(calculateSuggestedMinimum([10, 20, 30], 2), 40, 'month cover is configurable')

// An explicit override always wins, including an explicit zero.
assert.equal(resolveMinimumStock(null, 30), 30)
assert.equal(resolveMinimumStock(12, 30), 12)
assert.equal(resolveMinimumStock(0, 30), 0)

// Balances are derived from the immutable ledger, never a stored column.
assert.equal(sumMovementQuantities([]), 0)
assert.equal(sumMovementQuantities([{ quantity: 12.5 }, { quantity: -4.25 }]), 8.25)
assert.equal(
  sumMovementQuantities([{ quantity: 0.1 }, { quantity: 0.2 }]),
  0.3,
  'numeric(15,3) sums must not leak floating point drift',
)
assert.equal(roundQuantity(0.1 + 0.2), 0.3)

// Movement signs are fixed by type so the ledger cannot record a receive as an issue.
assert.deepEqual(
  [...MOVEMENT_TYPES],
  ['goods_receipt', 'requisition_issue', 'opening_adjustment', 'manual_adjustment', 'reversal'],
)
assert.equal(isMovementQuantityValid('goods_receipt', 5), true)
assert.equal(isMovementQuantityValid('goods_receipt', -5), false)
assert.equal(isMovementQuantityValid('requisition_issue', -5), true)
assert.equal(isMovementQuantityValid('requisition_issue', 5), false)
assert.equal(isMovementQuantityValid('opening_adjustment', 5), true)
assert.equal(isMovementQuantityValid('opening_adjustment', -5), false)
assert.equal(isMovementQuantityValid('manual_adjustment', -5), true)
assert.equal(isMovementQuantityValid('manual_adjustment', 5), true)
assert.equal(isMovementQuantityValid('manual_adjustment', 0), false, 'a zero movement is never valid')
assert.equal(isMovementQuantityValid('reversal', 5), true)
assert.equal(isMovementQuantityValid('reversal', 0), false)

// Stock level drives the Thai "ต้องทำ PR" call to action.
assert.equal(classifyStockLevel({ onHand: 0, minimum: 10 }), 'depleted')
assert.equal(classifyStockLevel({ onHand: 5, minimum: 10 }), 'below_minimum')
assert.equal(classifyStockLevel({ onHand: 10, minimum: 10 }), 'below_minimum', 'at minimum still needs a PR')
assert.equal(classifyStockLevel({ onHand: 11, minimum: 10 }), 'healthy')
assert.equal(classifyStockLevel({ onHand: 0, minimum: 0 }), 'depleted')
assert.equal(classifyStockLevel({ onHand: 5, minimum: 0 }), 'healthy', 'no minimum means no breach')

assert.equal(isProjectedBelowMinimum({ onHand: 20, minimum: 10, issueQuantity: 5 }), false)
assert.equal(isProjectedBelowMinimum({ onHand: 20, minimum: 10, issueQuantity: 10 }), true)
assert.equal(isProjectedBelowMinimum({ onHand: 20, minimum: 10, issueQuantity: 15 }), true)
assert.equal(isProjectedBelowMinimum({ onHand: 20, minimum: 0, issueQuantity: 20 }), true, 'reaching zero always warns')

// Lot expiry powers both the watchlist and FIFO disabling in Task 8.
assert.equal(classifyLotExpiry('2026-07-01', '2026-07-30'), 'expired')
assert.equal(classifyLotExpiry('2026-07-30', '2026-07-30'), 'expired', 'expiry day is no longer usable')
assert.equal(classifyLotExpiry('2026-08-15', '2026-07-30'), 'near_expiry')
assert.equal(classifyLotExpiry('2026-12-31', '2026-07-30'), 'usable')
assert.equal(classifyLotExpiry('2026-10-28', '2026-07-30', 90), 'near_expiry')
assert.equal(classifyLotExpiry('2026-10-29', '2026-07-30', 90), 'usable')
assert.equal(classifyLotExpiry(null, '2026-07-30'), 'usable', 'a lot without expiry never blocks issuing')

// LS codes are matched case-insensitively so Sheet variants reconcile in Task 10.
assert.equal(normalizeLsCode(' ls046022 '), 'LS046022')
assert.equal(normalizeLsCode('LS 046022'), 'LS046022')
assert.equal(normalizeLsCode('ls-046022'), 'LS046022')
assert.equal(normalizeLsCode(''), '')

console.log('inventory domain: ok')
