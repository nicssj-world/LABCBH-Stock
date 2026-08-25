import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getFloatingScrollbarState } from '../components/ui/StickyScroll'

const viewport = { height: 800, left: 40, right: 960 }

assert.equal(
  getFloatingScrollbarState({
    scrollWidth: 1_240,
    clientWidth: 920,
    rectTop: 160,
    rectBottom: 1_020,
    viewportHeight: viewport.height,
    viewportLeft: viewport.left,
    viewportRight: viewport.right,
  }).visible,
  true,
  'a wide table that continues below the viewport needs a floating horizontal scrollbar',
)

assert.equal(
  getFloatingScrollbarState({
    scrollWidth: 920,
    clientWidth: 920,
    rectTop: 160,
    rectBottom: 1_020,
    viewportHeight: viewport.height,
    viewportLeft: viewport.left,
    viewportRight: viewport.right,
  }).visible,
  false,
  'a table that fits its module must not render a redundant scrollbar',
)

assert.equal(
  getFloatingScrollbarState({
    scrollWidth: 1_240,
    clientWidth: 920,
    rectTop: 900,
    rectBottom: 1_760,
    viewportHeight: viewport.height,
    viewportLeft: viewport.left,
    viewportRight: viewport.right,
  }).visible,
  false,
  'a module below the viewport must wait until it enters the reading path',
)

assert.equal(
  getFloatingScrollbarState({
    scrollWidth: 1_240,
    clientWidth: 920,
    rectTop: -500,
    rectBottom: 700,
    viewportHeight: viewport.height,
    viewportLeft: viewport.left,
    viewportRight: viewport.right,
  }).visible,
  false,
  'a module that has already left the viewport must not leave a floating control behind',
)

const tableSources = [
  'components/contracts/ContractTable.tsx',
  'components/pr/PurchaseRequestTable.tsx',
  'components/inventory/InventoryTable.tsx',
  'components/inventory/LotTable.tsx',
  'components/settings/AccessMatrix.tsx',
  'components/contracts/ContractOpeningBalanceHistory.tsx',
  'components/contracts/ContractPurchaseHistory.tsx',
  'components/contracts/ExpenseHistory.tsx',
  'components/contracts/OpeningBalanceDialog.tsx',
  'components/pr/PrReviewPanel.tsx',
  'components/pr/PurchaseRequestForm.tsx',
  'components/receipts/ReceiptForm.tsx',
  'app/(protected)/contracts/[id]/page.tsx',
  'app/(protected)/inventory/[id]/page.tsx',
  'app/(protected)/purchase-requests/[id]/page.tsx',
  'app/(protected)/receipts/[id]/page.tsx',
  'app/(protected)/receipts/page.tsx',
  'app/(protected)/requisitions/[id]/page.tsx',
  'app/(protected)/requisitions/page.tsx',
]

for (const sourcePath of tableSources) {
  const source = readFileSync(sourcePath, 'utf8')
  assert.match(
    source,
    /<StickyScroll[\s\S]*?className=/,
    `${sourcePath} must use the shared sticky horizontal scrollbar`,
  )
}

const stickySource = readFileSync('components/ui/StickyScroll.tsx', 'utf8')
const cssSource = readFileSync('app/globals.css', 'utf8')
assert.match(cssSource, /\.sticky-scroll-floating\s*\{[\s\S]*?position:\s*fixed/, 'the shared scrollbar must stay reachable at the viewport edge')
assert.match(stickySource, /aria-label=/, 'the shared scrollbar must be keyboard and screen-reader discoverable')
assert.match(stickySource, /scrollLeft/, 'the table and floating scrollbar must synchronize horizontal position')

console.log('sticky scrollbar ui: ok')
