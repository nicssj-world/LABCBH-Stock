import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const expectations: Array<{ path: string; minimumMarkers: number }> = [
  { path: 'components/contracts/ContractForm.tsx', minimumMarkers: 7 },
  { path: 'components/contracts/ContractItemsEditor.tsx', minimumMarkers: 5 },
  { path: 'components/service-procurement/ServicePlanForm.tsx', minimumMarkers: 5 },
  { path: 'components/pr/PurchaseRequestForm.tsx', minimumMarkers: 5 },
  { path: 'components/pr/PurchaseMethodFields.tsx', minimumMarkers: 11 },
  { path: 'components/pr/ContractItemPicker.tsx', minimumMarkers: 3 },
  { path: 'components/receipts/ReceiptForm.tsx', minimumMarkers: 3 },
  { path: 'components/receipts/ReceiptLinesEditor.tsx', minimumMarkers: 2 },
  { path: 'components/requisitions/RequisitionForm.tsx', minimumMarkers: 4 },
  { path: 'components/inventory/InventoryItemForm.tsx', minimumMarkers: 3 },
  { path: 'components/contracts/ExpenseForm.tsx', minimumMarkers: 2 },
]

for (const expectation of expectations) {
  const source = read(expectation.path)
  const markerCount = source.match(/field-required/g)?.length ?? 0
  assert.ok(
    markerCount >= expectation.minimumMarkers,
    `${expectation.path} must mark every required field with a red required marker (found ${markerCount}, expected at least ${expectation.minimumMarkers})`,
  )
}

console.log('required field markers: ok')
