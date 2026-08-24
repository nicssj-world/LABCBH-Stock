import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const formOptions = read('lib/pr/form-options.ts')
const contractQueries = read('lib/contracts/queries.ts')
const inventoryQueries = read('lib/inventory/queries.ts')

assert.match(
  formOptions,
  /listContractFormOptions/,
  'the PR form must use the lightweight contract option read instead of the full contract register read',
)
assert.doesNotMatch(
  formOptions,
  /listContracts\(\{\}\)/,
  'opening the PR form must not load every contract with its nested detail rows',
)
assert.match(
  formOptions,
  /listInventoryItems\(\{\}, \{ includeAlertScope: false \}\)/,
  'the PR form does not need inventory alert-scope reads before an item is selected',
)
assert.match(
  formOptions,
  /const \[contractItems, committeeResult, nextPurchaseSequenceByContract\] = await Promise\.all\(/,
  'the remaining contract option reads must run in parallel',
)
assert.match(
  contractQueries,
  /export async function listContractFormOptions\(/,
  'contract form options need a dedicated lightweight query',
)
assert.match(
  inventoryQueries,
  /includeAlertScope\?: boolean/,
  'inventory reads need an explicit way to skip alert-only joins',
)

console.log('purchase request form options performance contract: ok')
