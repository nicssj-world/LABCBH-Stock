import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { omitNullishProperties } from '../lib/validation/json'

const normalized = omitNullishProperties({
  keepZero: 0,
  keepFalse: false,
  keepEmpty: '',
  keepText: 'value',
  dropNull: null,
  dropUndefined: undefined,
})

assert.deepEqual(normalized, {
  keepZero: 0,
  keepFalse: false,
  keepEmpty: '',
  keepText: 'value',
})

const boundaries = [
  ['lib/contracts/actions.ts', /p_items: rpcItems/],
  ['lib/contracts/actions.ts', /p_items: items\.map\(omitNullishProperties\)/],
  ['lib/pr/actions.ts', /p_items: items\.map\(omitNullishProperties\)/],
  ['lib/receipts/actions.ts', /p_items: items\.map\(omitNullishProperties\)/],
  ['lib/requisitions/actions.ts', /p_items: items\.map\(omitNullishProperties\)/],
  ['lib/requisitions/actions.ts', /p_allocations: parsed\.allocations\.map\(omitNullishProperties\)/],
] as const

for (const [file, pattern] of boundaries) {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
  assert.match(source, /import \{ omitNullishProperties \} from ['"]@\/lib\/validation\/json['"]/, `${file} must use the shared JSON payload normalizer`)
  assert.match(source, pattern, `${file} must omit nullish nested RPC fields before submission`)
}

const openingBalanceMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260808090000_contract_opening_balance.sql'),
  'utf8',
)
assert.match(
  openingBalanceMigration,
  /where item \? 'openingUsedQuantity'[\s\S]*jsonb_typeof\(item -> 'openingUsedQuantity'\) is distinct from 'number'/,
  'the database must keep the optional opening balance guard explicit',
)

console.log('RPC payload nullability boundaries: ok')
