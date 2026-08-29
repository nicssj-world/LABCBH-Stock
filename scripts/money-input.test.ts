import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatMoneyInput, normalizeMoneyInput, parseMoneyInput } from '@/lib/format/money-input'

assert.equal(formatMoneyInput('1234'), '1,234')
assert.equal(formatMoneyInput('1234567.5'), '1,234,567.5')
assert.equal(formatMoneyInput('1234.'), '1,234.')
assert.equal(formatMoneyInput('.5'), '0.5')
assert.equal(formatMoneyInput(0), '0')
assert.equal(normalizeMoneyInput('1,234.567'), '1234.56')
assert.equal(parseMoneyInput('1,234.50'), 1234.5)
assert.equal(parseMoneyInput(''), null)

const read = (path: string) => readFileSync(path, 'utf8')
const priceInputFiles = [
  'components/contracts/ContractForm.tsx',
  'components/contracts/ContractItemsEditor.tsx',
  'components/contracts/ExpenseForm.tsx',
  'components/contracts/StageAdvanceControl.tsx',
  'components/inventory/InventoryItemForm.tsx',
  'components/pr/ContractItemPicker.tsx',
  'components/pr/PurchaseRequestForm.tsx',
  'components/service-procurement/ServicePlanExpenseControls.tsx',
  'components/service-procurement/ServicePlanForm.tsx',
  'components/service-procurement/ServicePurchaseRequestControls.tsx',
  'components/service-procurement/ServicePurchaseRequestForm.tsx',
]

for (const file of priceInputFiles) {
  assert.match(read(file), /MoneyInput/, `${file} should use the shared money input`)
}

assert.match(read('components/ui/FormattedNumberInput.tsx'), /inputMode="decimal"/)
assert.match(read('components/ui/FormattedNumberInput.tsx'), /type="text"/)
console.log('money input formatting: ok')
