import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const route = readFileSync('app/api/dashboard/watchlist/route.ts', 'utf8')
assert.match(route, /getActor/)
assert.match(route, /searchParams/)
assert.match(route, /getDashboardWatchlistPage/)
assert.match(route, /NextResponse\.json/)
assert.match(route, /status:\s*401/)
assert.match(route, /limit/)
assert.match(route, /offset/)

const disclosure = readFileSync('components/dashboard/DashboardWatchlist.tsx', 'utf8')
assert.match(disclosure, /^'use client'/)
assert.match(disclosure, /แสดงเพิ่มเติม/)
assert.match(disclosure, /ยุบรายการ/)
assert.match(disclosure, /aria-expanded/)
assert.match(disclosure, /\/api\/dashboard\/watchlist/)
assert.match(disclosure, /aria-live/)
assert.match(disclosure, /ลองใหม่/)

const dashboardPage = readFileSync('app/(protected)/dashboard/page.tsx', 'utf8')
assert.match(dashboardPage, /getExecutiveDashboard\(\{\s*watchlistLimit:\s*5\s*\}\)/)
assert.match(dashboardPage, /<DashboardWatchlist/)
assert.match(dashboardPage, /watchlistTotal/)
assert.match(dashboardPage, /\/purchase-requests\/new/)
assert.match(dashboardPage, /\/requisitions\/new/)

const globalStyles = readFileSync('app/globals.css', 'utf8')
assert.match(globalStyles, /\.dashboard-operations\s*\{[\s\S]*grid-template-areas:/)
assert.match(globalStyles, /\.dashboard-watchlist__disclosure\s*\{[\s\S]*min-height:\s*64px/)
assert.match(globalStyles, /\.watchlist li:focus-visible/)
assert.match(globalStyles, /\.dashboard-watchlist__button\s*\{[\s\S]*min-height:\s*44px/)
assert.match(globalStyles, /@media \(max-width: 540px\)[\s\S]*dashboard-watchlist__disclosure/)

console.log('dashboard watchlist pagination: ok')
