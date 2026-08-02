import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatThaiDateInput, parseThaiDateInput } from '../lib/date/thai'

assert.equal(formatThaiDateInput('2026-08-02'), '02/08/2569')
assert.equal(parseThaiDateInput('02/08/2569'), '2026-08-02')
assert.equal(parseThaiDateInput('2-8-2569'), '2026-08-02')
assert.equal(parseThaiDateInput('2026-08-02'), '2026-08-02', 'ISO paste remains supported')
assert.equal(parseThaiDateInput('๐๒/๐๘/๒๕๖๙'), '2026-08-02', 'Thai digits are accepted')
assert.equal(parseThaiDateInput('31/02/2569'), null, 'invalid calendar dates are rejected')
assert.equal(parseThaiDateInput(''), '')

const dateInput = readFileSync('components/ui/ThaiDateInput.tsx', 'utf8')
assert.match(dateInput, /พ\.ศ\./, 'date fields explain the Buddhist Era input format')
assert.match(dateInput, /parseThaiDateInput/, 'date fields emit parsed ISO values')
assert.match(dateInput, /CalendarPicker/, 'date fields must also offer a clickable calendar, not typing alone')
assert.match(dateInput, /showModal\(\)/, 'the calendar opens through a dialog, matching the app-dialog convention')

const calendarPicker = readFileSync('components/ui/CalendarPicker.tsx', 'utf8')
assert.match(calendarPicker, /aria-pressed/, 'calendar days must expose their selected state accessibly')

for (const path of [
  'components/requisitions/RequisitionForm.tsx',
  'components/receipts/ReceiptForm.tsx',
  'components/receipts/ReceiptLinesEditor.tsx',
  'components/pr/PurchaseRequestForm.tsx',
  'components/contracts/ContractForm.tsx',
  'components/contracts/ExpenseForm.tsx',
  'components/contracts/StageAdvanceControl.tsx',
  'components/contracts/StageHistoryEditor.tsx',
  'components/contracts/StageHistoryEntryEditor.tsx',
]) {
  const source = readFileSync(path, 'utf8')
  assert.doesNotMatch(source, /type=["']date["']/, `${path} must use the Buddhist Era date input`)
}

console.log('Thai Buddhist Era dates: ok')
