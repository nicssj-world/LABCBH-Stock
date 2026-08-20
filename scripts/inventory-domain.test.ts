import assert from 'node:assert/strict'
import {
  DEFAULT_MINIMUM_STOCK_MONTHS,
  MOVEMENT_TYPES,
  calculateSuggestedMinimum,
  classifyLotExpiry,
  classifyStockAlert,
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


// classifyStockAlert is narrower than classifyStockLevel on purpose: the level
// describes the item, the alert decides whether it belongs on anyone's list.
// Measured on production 2026-08-21, the old rule counted 117 of 172 active
// items and 115 of those had never had a single movement.
const stocked = { hasMovements: true, hasOpenRequest: false, minimumStockOverride: null }

assert.equal(classifyStockAlert({ stockLevel: 'healthy', ...stocked }), null)
assert.equal(classifyStockAlert({ stockLevel: 'depleted', ...stocked }), 'depleted')
assert.equal(classifyStockAlert({ stockLevel: 'below_minimum', ...stocked }), 'below_minimum')

// A catalogue row imported from the old Sheet and never received is not a
// stock-out; it is a name in a list.
assert.equal(
  classifyStockAlert({ stockLevel: 'depleted', hasMovements: false, hasOpenRequest: false, minimumStockOverride: null }),
  null,
  'an item with no ledger history at all must not be counted as needing a PR',
)

// Unless somebody stated a reserve level for it — that is an explicit
// statement of intent to stock the item, even before its first receipt.
assert.equal(
  classifyStockAlert({ stockLevel: 'depleted', hasMovements: false, hasOpenRequest: false, minimumStockOverride: 20 }),
  'depleted',
  'an explicit reserve level means the item is meant to be stocked',
)
assert.equal(
  classifyStockAlert({ stockLevel: 'depleted', hasMovements: false, hasOpenRequest: false, minimumStockOverride: 0 }),
  null,
  'a deliberate zero reserve is a statement that the item is not stocked',
)

// The old count never looked at purchase requests, so raising one left the
// number unchanged — it could only fall when goods arrived. A worklist that
// cannot be cleared by doing the work it names is not a worklist.
assert.equal(
  classifyStockAlert({ stockLevel: 'depleted', hasMovements: true, hasOpenRequest: true, minimumStockOverride: null }),
  null,
  'an item already covered by a draft or pending PR has had its action taken',
)
assert.equal(
  classifyStockAlert({ stockLevel: 'below_minimum', hasMovements: true, hasOpenRequest: true, minimumStockOverride: 5 }),
  null,
  'an open request outranks even an explicit reserve level',
)
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
