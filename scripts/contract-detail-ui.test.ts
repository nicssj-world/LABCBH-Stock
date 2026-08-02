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

console.log('contract detail UI: ok')
