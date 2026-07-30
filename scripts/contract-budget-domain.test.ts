import assert from 'node:assert/strict'
import {
  budgetSnapshot,
  contractMode,
  expenseMonthOptions,
  isExpiring,
  isLowBudget,
  monthsLeft,
  normalizeUsageMonth,
} from '../lib/contracts/budget'

// Only equipment leases are tracked in baht. Everything else keeps line items.
assert.equal(contractMode('equipment_lease'), 'budget')
assert.equal(contractMode('e_bidding'), 'supply')
assert.equal(contractMode('awaiting_equipment_lease'), 'supply')

// A month is stored as its first day so two entries for the same month collide.
assert.equal(normalizeUsageMonth('2026-07'), '2026-07-01')
assert.equal(normalizeUsageMonth('2026-07-19'), '2026-07-01')
assert.equal(normalizeUsageMonth('2026-13'), null, 'month 13 is not a month')
assert.equal(normalizeUsageMonth('2026-00'), null)
assert.equal(normalizeUsageMonth('rubbish'), null)

// Remaining is rounded to satang before comparison so float drift cannot make
// an exactly-exhausted budget look like it has a fraction left.
const snap = budgetSnapshot({ total: 1000, entries: [{ amount: 333.33 }, { amount: 666.67 }] })
assert.equal(snap.used, 1000)
assert.equal(snap.remaining, 0)
assert.equal(snap.exhausted, true)
assert.equal(snap.percentUsed, 100)

// A contract with no total has an unknown budget, not a zero one.
const unknown = budgetSnapshot({ total: null, entries: [{ amount: 500 }] })
assert.equal(unknown.remaining, null)
assert.equal(unknown.percentUsed, null)
assert.equal(unknown.used, 500)

const now = new Date('2026-07-30T00:00:00Z')
// Large contracts get a longer runway because replacing them takes longer.
assert.equal(isExpiring(20_000_000, '2026-12-01', now), true, 'big contract, 4 months out')
assert.equal(isExpiring(5_000_000, '2026-12-01', now), false, 'small contract, 4 months out')
assert.equal(isExpiring(5_000_000, '2026-09-15', now), true, 'small contract, under 3 months')
assert.equal(isExpiring(5_000_000, null, now), false, 'no end date never expires')
assert.equal(monthsLeft(null, now), 999)

assert.equal(isLowBudget(1000, 701), true, 'under 30% remaining')
assert.equal(isLowBudget(1000, 700), false, 'exactly 30% is not low')
assert.equal(isLowBudget(null, 700), false, 'unknown total is not low')
assert.equal(isLowBudget(0, 0), false, 'zero total cannot be a ratio')

// Options are bounded by the contract term so nobody bills a month it did not cover.
assert.deepEqual(
  expenseMonthOptions('2026-05-10', '2026-08-20'),
  ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'],
)
assert.deepEqual(expenseMonthOptions(null, '2026-08-20'), [])

console.log('contract budget domain tests passed')
