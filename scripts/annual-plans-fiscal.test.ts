import assert from 'node:assert/strict'
import { fiscalYearOfDate, isRetainedFiscalYear, retainedFiscalYears } from '../lib/annual-plans/fiscal'

// Bangkok midnight is the boundary that decides whether a document belongs
// to the previous or the new Thai fiscal year.
assert.equal(fiscalYearOfDate(new Date('2026-09-30T16:59:59.000Z')), 2569)
assert.equal(fiscalYearOfDate(new Date('2026-09-30T17:00:00.000Z')), 2570)

assert.deepEqual(retainedFiscalYears(new Date('2026-10-01T00:00:00.000Z')), [2570, 2569])
assert.deepEqual(retainedFiscalYears(new Date('2026-08-25T00:00:00.000Z')), [2569, 2568])
assert.equal(isRetainedFiscalYear(2569, new Date('2026-08-25T00:00:00.000Z')), true)
assert.equal(isRetainedFiscalYear(2567, new Date('2026-08-25T00:00:00.000Z')), false)

console.log('annual plans fiscal-year helpers: ok')
