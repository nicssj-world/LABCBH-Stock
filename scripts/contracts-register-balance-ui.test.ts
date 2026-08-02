import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const disclosure = read('components/contracts/ContractItemsDisclosure.tsx')
const table = read('components/contracts/ContractTable.tsx')
const gauge = read('components/contracts/ContractRemainingGauge.tsx')
const styles = read('app/globals.css')

assert.match(table, /ContractItemsDisclosure/, 'the all-contracts register must keep the item disclosure as the line-item surface')
assert.match(disclosure, /item\.remainingQuantity/, 'each disclosed contract item must show its remaining quantity')
assert.match(disclosure, /item\.quantity/, 'each disclosed contract item must retain its contracted quantity')
assert.match(disclosure, /item\.remainingPercent/, 'each disclosed contract item must show a remaining percentage')
assert.match(disclosure, /ContractRemainingGauge/, 'each disclosed contract item must reuse the shared gauge pattern')
assert.match(disclosure, /compact/, 'each disclosed contract item must use the compact gauge variant')
assert.match(disclosure, /contract-items-disclosure__meta/, 'item identity and quantity should share one compact metadata row')
assert.doesNotMatch(disclosure, /item\.lsCode/, 'parcel codes must stay out of the expanded contract item presentation')
assert.doesNotMatch(disclosure, /ไม่ระบุรหัส/, 'the parcel-code fallback must stay out of the expanded contract item presentation')
assert.doesNotMatch(disclosure, /คงเหลือ \/ ตามสัญญา/, 'repeated helper copy must not make the expanded list noisy')
assert.match(gauge, /role="progressbar"/, 'the shared gauge must expose progress semantics')
assert.match(gauge, /compact\?: boolean/, 'the shared gauge must support a compact presentation')
assert.match(disclosure, /contract-items-disclosure__gauge/, 'item gauges need a compact, dedicated visual treatment')
assert.match(styles, /\.contract-items-disclosure__gauge/, 'the register item gauge must have responsive styles')
assert.match(styles, /\.remaining-gauge--compact/, 'the compact gauge must have a dedicated visual treatment')
assert.match(styles, /\.contract-items-disclosure__identity strong[^}]*overflow-wrap: anywhere/, 'long item names must wrap instead of being clipped')
assert.match(styles, /\.contract-items-disclosure__meta[^}]*white-space: normal/, 'item balance metadata must wrap when the name column is narrow')
assert.doesNotMatch(styles, /\.contract-items-disclosure__meta[^}]*overflow: hidden/, 'item balance metadata must remain readable instead of being hidden')

console.log('contracts register balance UI: ok')
