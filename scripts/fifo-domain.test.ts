import assert from 'node:assert/strict'
import {
  defaultLotSelection,
  isLotSelectable,
  rankLotsForFifo,
  requiresOverrideReason,
  validateLotAllocations,
} from '../lib/requisitions/fifo'

// Ordering follows the specification: received date, then expiry, then balance.
const ranked = rankLotsForFifo([
  { id: 'b', receivedAt: '2026-02-01', expiryDate: '2027-01-01', balance: 5 },
  { id: 'a', receivedAt: '2026-01-01', expiryDate: '2026-12-01', balance: 5 },
])
assert.deepEqual(ranked.map((row) => row.id), ['a', 'b'])

assert.deepEqual(
  rankLotsForFifo([
    { id: 'later-expiry', receivedAt: '2026-01-01', expiryDate: '2027-01-01', balance: 5 },
    { id: 'sooner-expiry', receivedAt: '2026-01-01', expiryDate: '2026-06-01', balance: 5 },
  ]).map((row) => row.id),
  ['sooner-expiry', 'later-expiry'],
  'same received date falls back to expiry',
)

assert.deepEqual(
  rankLotsForFifo([
    { id: 'big', receivedAt: '2026-01-01', expiryDate: '2026-06-01', balance: 9 },
    { id: 'small', receivedAt: '2026-01-01', expiryDate: '2026-06-01', balance: 2 },
  ]).map((row) => row.id),
  ['small', 'big'],
  'same date and expiry drains the smaller lot first',
)

// A lot with no expiry never sorts ahead of one that will actually expire.
assert.deepEqual(
  rankLotsForFifo([
    { id: 'no-expiry', receivedAt: '2026-01-01', expiryDate: null, balance: 5 },
    { id: 'expires', receivedAt: '2026-01-01', expiryDate: '2030-01-01', balance: 5 },
  ]).map((row) => row.id),
  ['expires', 'no-expiry'],
)

assert.deepEqual(rankLotsForFifo([]), [])

// Expired or empty lots cannot be issued at all.
const today = '2026-07-30'
assert.equal(isLotSelectable({ id: 'a', receivedAt: '2026-01-01', expiryDate: '2026-12-01', balance: 5 }, today), true)
assert.equal(isLotSelectable({ id: 'a', receivedAt: '2026-01-01', expiryDate: '2026-07-01', balance: 5 }, today), false)
assert.equal(isLotSelectable({ id: 'a', receivedAt: '2026-01-01', expiryDate: '2026-07-30', balance: 5 }, today), false)
assert.equal(isLotSelectable({ id: 'a', receivedAt: '2026-01-01', expiryDate: '2026-12-01', balance: 0 }, today), false)
assert.equal(isLotSelectable({ id: 'a', receivedAt: '2026-01-01', expiryDate: null, balance: 5 }, today), true)

// Skipping an older usable lot must be justified in writing.
const lots = [
  { id: 'old', receivedAt: '2026-01-01', expiryDate: '2026-12-01', balance: 5 },
  { id: 'middle', receivedAt: '2026-03-01', expiryDate: '2026-12-15', balance: 5 },
  { id: 'new', receivedAt: '2026-05-01', expiryDate: '2027-01-01', balance: 5 },
]
assert.equal(requiresOverrideReason(lots, ['old'], today), false)
assert.equal(requiresOverrideReason(lots, ['old', 'new'], today), true, 'skipping the middle usable lot needs a reason')
assert.equal(requiresOverrideReason(lots, ['old', 'middle'], today), false)
assert.equal(requiresOverrideReason(lots, ['old', 'middle', 'new'], today), false)
assert.equal(
  requiresOverrideReason(lots, ['old', 'new'], today),
  true,
  'skipping the middle usable lot needs a reason',
)
assert.equal(requiresOverrideReason(lots, ['new'], today), true, 'skipping the oldest usable lot needs a reason')
assert.equal(
  requiresOverrideReason(
    [{ id: 'expired', receivedAt: '2025-01-01', expiryDate: '2026-01-01', balance: 5 }, lots[1]],
    ['new'],
    today,
  ),
  false,
  'an expired older lot is not a lot that was skipped',
)
assert.equal(requiresOverrideReason(lots, [], today), false)

// Allocation totals may be a positive short issue, but never exceed the request
// or the selected lot balance. The companion short-issue reason is validated by
// the fulfillment panel and the database RPC.
const balances = new Map([['old', 5], ['new', 5]])
assert.deepEqual(
  validateLotAllocations({
    requestedQuantity: 7,
    allocations: [{ lotId: 'old', quantity: 5 }, { lotId: 'new', quantity: 2 }],
    lotBalances: balances,
  }),
  [],
)
assert.deepEqual(
  validateLotAllocations({
    requestedQuantity: 7,
    allocations: [{ lotId: 'old', quantity: 5 }],
    lotBalances: balances,
  }),
  [],
)
assert.deepEqual(
  validateLotAllocations({
    requestedQuantity: 9,
    allocations: [{ lotId: 'old', quantity: 9 }],
    lotBalances: balances,
  }),
  ['ล็อต old มีคงเหลือ 5 ไม่พอจ่าย 9'],
)
assert.deepEqual(
  validateLotAllocations({
    requestedQuantity: 5,
    allocations: [{ lotId: 'old', quantity: 0 }, { lotId: 'new', quantity: 5 }],
    lotBalances: balances,
  }),
  ['จำนวนที่จ่ายของแต่ละล็อตต้องมากกว่า 0'],
)
assert.deepEqual(
  validateLotAllocations({
    requestedQuantity: 5,
    allocations: [{ lotId: 'old', quantity: 2 }, { lotId: 'old', quantity: 3 }],
    lotBalances: balances,
  }),
  ['เลือกล็อตเดียวกันซ้ำ'],
)

// The panel pre-fills rank 1 at the full request, capped to what it has, so
// the officer doesn't have to click before adjusting the common case.
const rankedLots = [
  { id: 'top', balance: 100, selectable: true },
  { id: 'second', balance: 100, selectable: true },
]
assert.deepEqual(
  defaultLotSelection(rankedLots, 50),
  [{ lotId: 'top', quantity: 50 }],
  'the top-ranked lot is pre-filled at the requested quantity',
)
assert.deepEqual(
  defaultLotSelection(rankedLots, 150),
  [{ lotId: 'top', quantity: 100 }],
  'a request bigger than the top lot is capped, not left over-filled',
)
assert.deepEqual(
  defaultLotSelection(
    [{ id: 'expired', balance: 100, selectable: false }, { id: 'usable', balance: 20, selectable: true }],
    5,
  ),
  [{ lotId: 'usable', quantity: 5 }],
  'an unselectable lot ranked first must be skipped, not pre-filled',
)
assert.deepEqual(
  defaultLotSelection([{ id: 'expired', balance: 100, selectable: false }], 5),
  [],
  'nothing is pre-filled when no lot is currently selectable',
)
assert.deepEqual(defaultLotSelection([], 5), [])

console.log('FIFO domain: ok')
