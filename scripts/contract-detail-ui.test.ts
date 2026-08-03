import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const detailPage = read('app/(protected)/contracts/[id]/page.tsx')
const queries = read('lib/contracts/queries.ts')

assert.match(detailPage, /remainingTotal/, 'E-Bidding detail must calculate a total remaining value')
assert.match(detailPage, /ยอดคงเหลือรวม/, 'the total remaining value needs a clear Thai label')
assert.match(detailPage, /item\.remainingQuantity/, 'each contract line must show its remaining quantity')
assert.match(detailPage, /item\.remainingValue/, 'each contract line must show its remaining value')
assert.match(detailPage, /item\.remainingPercent/, 'each contract line must expose a percentage for its remaining-balance gauge')
assert.match(detailPage, /role="progressbar"/, 'each contract line gauge must be accessible to assistive technology')
assert.match(detailPage, /ContractRemainingGauge/, 'the total remaining balance should reuse the shared gauge pattern')
assert.match(detailPage, /ใช้ไป/, 'each line must explain the consumed quantity, not rely on color alone')
assert.match(queries, /contractSupplyBalance/, 'contract reads must use the shared supply balance calculation')
assert.match(queries, /allocatedQuantity/, 'contract reads must preserve the allocated quantity from the ledger')

// Purchase history: every "ซื้อในสัญญา" PR against a started supply contract,
// 5 most recent shown by default with a "ดูเพิ่ม" expand control.
assert.match(detailPage, /ContractPurchaseHistory/, 'a started supply contract must show its purchase history')
assert.match(
  detailPage,
  /mode === 'supply' && isContractStarted\s*\?\s*await listContractPurchaseHistory/,
  'purchase history must only be fetched for a started supply contract — a lease never uses the contract PR method',
)
assert.match(detailPage, /ประวัติการซื้อ/)

const prQueries = read('lib/pr/queries.ts')
assert.match(prQueries, /export async function listContractPurchaseHistory/)
assert.match(
  prQueries,
  /\.eq\('purchase_method', 'contract'\)/,
  'purchase history must read from the same contract-drawdown PR method',
)
assert.match(
  prQueries,
  /Number\(request\.methodDetails\.contractId\) === contractId/,
  'rows must be filtered to the requested contract in JS, matching this file\'s existing methodDetails-reading convention',
)
assert.match(
  prQueries,
  /Number\(right\.methodDetails\.purchaseSequence\) - Number\(left\.methodDetails\.purchaseSequence\)/,
  'purchase history must sort newest purchase (highest sequence) first',
)

const purchaseHistoryComponent = read('components/contracts/ContractPurchaseHistory.tsx')
assert.match(purchaseHistoryComponent, /^['"]use client['"]/m)
assert.match(purchaseHistoryComponent, /VISIBLE_LIMIT = 5/, 'exactly 5 purchases show before the show-more control')
assert.match(purchaseHistoryComponent, /ยังไม่มีการซื้อภายใต้สัญญานี้/, 'an empty history needs its own explicit state')
assert.match(purchaseHistoryComponent, /ดูเพิ่มอีก/, 'the expand control must say how many more purchases exist')
assert.match(purchaseHistoryComponent, /ย่อรายการ/, 'the control must also collapse back down once expanded')
assert.doesNotMatch(
  purchaseHistoryComponent,
  /createBrowserClient|supabase\.from/,
  'the browser must never mutate or query Supabase directly',
)

// Clicking a purchase opens a summary popup of that PR's items — no extra
// fetch, since listContractPurchaseHistory already loaded every item.
assert.match(purchaseHistoryComponent, /<dialog\b/, 'a purchase summary must use the native dialog element, matching every other dialog in this app')
assert.match(purchaseHistoryComponent, /showModal\(\)/)
assert.match(purchaseHistoryComponent, /selected\.items\.map/, 'the popup must list every line item of the clicked purchase')
assert.match(purchaseHistoryComponent, /selected\.items\.length/, 'the popup must show how many items the purchase had')
assert.match(purchaseHistoryComponent, /formatBaht\(selected\.total\)/, 'the popup must show the purchase grand total')
assert.match(purchaseHistoryComponent, /formatBaht\(item\.unitPrice\)/, 'the popup must show each line\'s unit price')
assert.match(purchaseHistoryComponent, /formatBaht\(item\.lineTotal\)/, 'the popup must show each line\'s total')

console.log('contract detail UI: ok')
