import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LIST_PAGE_SIZE, paginate, parsePage } from '@/lib/pagination'

assert.equal(parsePage(undefined), 1)
assert.equal(parsePage('0'), 1)
assert.equal(parsePage('-2'), 1)
assert.equal(parsePage('2'), 2)
assert.equal(parsePage('2.5'), 1)

const result = paginate(['a', 'b', 'c', 'd', 'e'], 2, 2)
assert.deepEqual(result.items, ['c', 'd'])
assert.equal(result.currentPage, 2)
assert.equal(result.pageCount, 3)
assert.equal(result.totalCount, 5)
assert.equal(result.startIndex, 2)

const clamped = paginate(['a', 'b', 'c'], 99, 2)
assert.deepEqual(clamped.items, ['c'])
assert.equal(clamped.currentPage, 2)

const autoFilter = readFileSync('components/ui/AutoFilterBench.tsx', 'utf8')
assert.match(autoFilter, /nextParams\.delete\('page'\)/, 'changing a filter must return to the first page')
assert.equal(LIST_PAGE_SIZE, 25)

console.log('pagination: ok')
