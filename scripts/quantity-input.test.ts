import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatNumberInput, normalizeNumberInput, parseNumberInput } from '@/lib/format/number-input'

assert.equal(formatNumberInput('1234'), '1,234')
assert.equal(formatNumberInput('1234567.125'), '1,234,567.125')
assert.equal(formatNumberInput('1234.'), '1,234.')
assert.equal(formatNumberInput('.5'), '0.5')
assert.equal(formatNumberInput('1234.56', 0), '1,234')
assert.equal(normalizeNumberInput('1,234.5678', 3), '1234.567')
assert.equal(normalizeNumberInput('1,234.5678', 0), '1234')
assert.equal(parseNumberInput('1,234.500', 3), 1234.5)
assert.equal(parseNumberInput(''), null)

const read = (path: string) => readFileSync(path, 'utf8')
const quantityInputFiles = [
  'components/contracts/ContractItemsEditor.tsx',
  'components/contracts/OpeningBalanceDialog.tsx',
  'components/inventory/InventoryMinimumStockSettings.tsx',
  'components/inventory/StockAdjustmentDialog.tsx',
  'components/pr/PurchaseRequestForm.tsx',
  'components/receipts/ReceiptLinesEditor.tsx',
  'components/requisitions/LotPicker.tsx',
  'components/requisitions/RequisitionForm.tsx',
  'components/service-procurement/ServicePurchaseRequestForm.tsx',
]

for (const file of quantityInputFiles) {
  assert.match(read(file), /QuantityInput/, `${file} should use the shared quantity input`)
}

assert.match(read('components/ui/QuantityInput.tsx'), /maxFractionDigits/)
assert.match(read('components/ui/FormattedNumberInput.tsx'), /inputMode="decimal"/)
assert.match(read('components/ui/FormattedNumberInput.tsx'), /type="text"/)
console.log('quantity input formatting: ok')
