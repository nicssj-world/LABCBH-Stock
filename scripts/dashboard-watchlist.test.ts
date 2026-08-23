import assert from 'node:assert/strict'
import { compareDashboardWatchItems, paginateDashboardWatchlist } from '../lib/dashboard/watchlist'
import type { DashboardWatchItem } from '../lib/dashboard/types'

const items: DashboardWatchItem[] = [
  { contractId: 2, lsCode: 'B', remainingPercent: 10 },
  { contractId: 1, lsCode: 'C', remainingPercent: 10 },
  { contractId: 1, lsCode: 'A', remainingPercent: 0 },
  { contractId: 3, lsCode: 'D', remainingPercent: 27 },
].map((item) => ({
  ...item,
  contractName: 'Contract',
  fiscalYear: 2569,
  name: item.lsCode,
  unit: 'test',
  contractedQuantity: 100,
  allocatedQuantity: 100 - item.remainingPercent,
  remainingQuantity: item.remainingPercent,
  remainingValue: item.remainingPercent,
}))

const ordered = [...items].sort(compareDashboardWatchItems)
assert.deepEqual(ordered.map((item) => item.lsCode), ['A', 'C', 'B', 'D'])

const firstPage = paginateDashboardWatchlist(ordered, 0, 2)
assert.deepEqual(firstPage.items.map((item) => item.lsCode), ['A', 'C'])
assert.equal(firstPage.totalCount, 4)
assert.equal(firstPage.nextOffset, 2)

const lastPage = paginateDashboardWatchlist(ordered, 2, 2)
assert.deepEqual(lastPage.items.map((item) => item.lsCode), ['B', 'D'])
assert.equal(lastPage.nextOffset, null)

console.log('dashboard watchlist pagination: ok')
