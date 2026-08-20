import assert from 'node:assert/strict'
import {
  fiscalQuarterOfMonth,
  fiscalYearBounds,
  fiscalYearOfMonth,
  missingUsagePeriods,
  usageByFiscalYear,
} from '../lib/out-lab/fiscal'

// The Thai fiscal year opens in October of the *previous* calendar year. Get
// this wrong by one and every reminder chip in the module is wrong all year.
assert.deepEqual(fiscalYearBounds(2569), { startDate: '2025-10-01', endDate: '2026-09-30' })
assert.deepEqual(fiscalYearBounds(2568), { startDate: '2024-10-01', endDate: '2025-09-30' })

// September and October are the boundary: adjacent months, different years.
assert.equal(fiscalYearOfMonth('2026-09'), 2569)
assert.equal(fiscalYearOfMonth('2025-10-01'), 2569)
assert.equal(fiscalYearOfMonth('2025-09-30'), 2568)
assert.equal(fiscalYearOfMonth('2026-13'), null)
assert.equal(fiscalYearOfMonth('nonsense'), null)

assert.equal(fiscalQuarterOfMonth('2025-10'), 1)
assert.equal(fiscalQuarterOfMonth('2025-12'), 1)
assert.equal(fiscalQuarterOfMonth('2026-01'), 2)
assert.equal(fiscalQuarterOfMonth('2026-06'), 3)
assert.equal(fiscalQuarterOfMonth('2026-09'), 4)

const planPeriod = fiscalYearBounds(2569)
const asOf = new Date('2026-03-15T00:00:00Z')

// "When there is usage" has no schedule, so it can never be behind.
assert.deepEqual(
  missingUsagePeriods(
    { cadence: 'as_needed', startDate: planPeriod.startDate, endDate: planPeriod.endDate, entries: [] },
    asOf,
  ),
  [],
)

// Monthly: Oct 2025 - Feb 2026 have elapsed by 15 Mar 2026. March itself is
// still open and must not be reported, or the chip cries wolf every month.
const monthlyGaps = missingUsagePeriods(
  {
    cadence: 'monthly',
    startDate: planPeriod.startDate,
    endDate: planPeriod.endDate,
    entries: [{ usageMonth: '2025-10-01' }, { usageMonth: '2025-11-01' }, { usageMonth: '2026-01-01' }],
  },
  asOf,
)
assert.deepEqual(monthlyGaps, [
  { period: 'month', month: '2025-12-01' },
  { period: 'month', month: '2026-02-01' },
])
assert.ok(
  !monthlyGaps.some((gap) => gap.period === 'month' && gap.month === '2026-03-01'),
  'the current month has not closed yet and is never reported as missing',
)

// Quarterly: one figure anywhere in the quarter settles the whole quarter.
assert.deepEqual(
  missingUsagePeriods(
    {
      cadence: 'quarterly',
      startDate: planPeriod.startDate,
      endDate: planPeriod.endDate,
      entries: [{ usageMonth: '2025-11-01' }],
    },
    asOf,
  ),
  [],
  'Q1 is covered by its November entry, and Q2 (Jan-Mar) has not fully elapsed',
)

// Once Q2 has closed, an untouched Q2 is reported as a quarter, not as three
// separate months - reporting months would misstate what the contract owes.
assert.deepEqual(
  missingUsagePeriods(
    {
      cadence: 'quarterly',
      startDate: planPeriod.startDate,
      endDate: planPeriod.endDate,
      entries: [{ usageMonth: '2025-11-01' }],
    },
    new Date('2026-04-10T00:00:00Z'),
  ),
  [{ period: 'quarter', fiscalYear: 2569, quarter: 2, startMonth: '2026-01-01', endMonth: '2026-03-01' }],
)

// A contract with no period cannot be judged at all.
assert.deepEqual(
  missingUsagePeriods({ cadence: 'monthly', startDate: null, endDate: null, entries: [] }, asOf),
  [],
)

// Subtotals split at the fiscal-year boundary, and sum in satang so a year's
// figure cannot drift away from the contract total shown above it.
assert.deepEqual(
  usageByFiscalYear([
    { usageMonth: '2025-09-01', amount: 0.1 },
    { usageMonth: '2025-10-01', amount: 0.2 },
    { usageMonth: '2026-09-01', amount: 0.1 },
    { usageMonth: null, amount: 999 },
  ]),
  [
    { fiscalYear: 2568, used: 0.1 },
    { fiscalYear: 2569, used: 0.3 },
  ],
)

console.log('out lab fiscal-year helpers: ok')
