import assert from 'node:assert/strict'
import {
  classifySheetRow,
  normalizeContractNumber,
  normalizeLsCode,
} from '../lib/import/normalize'

assert.equal(normalizeLsCode(' ls046022 '), 'LS046022')
assert.equal(normalizeLsCode('LS 046022'), 'LS046022')
assert.equal(normalizeLsCode('ls-046022'), 'LS046022')
assert.equal(normalizeLsCode('#REF!'), '')

assert.equal(normalizeContractNumber('  กค  12 / 2569  '), 'กค 12/2569')
assert.equal(normalizeContractNumber(null), '')

assert.equal(classifySheetRow({ lsCode: '', unit: 'บาท' }), 'contract_summary')
assert.equal(classifySheetRow({ lsCode: 'LS046022', unit: 'กล่อง' }), 'contract_item')
assert.equal(classifySheetRow({ lsCode: '', unit: '' }), 'ignored')

console.log('import normalization: ok')
