import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addIsoDays, bangkokIsoDate, formatThaiDateInput, formatThaiDateLong, parseThaiDateInput } from '../lib/date/thai'

assert.equal(formatThaiDateInput('2026-08-02'), '02/08/2569')
assert.equal(formatThaiDateLong('2025-10-01'), '01 ตุลาคม 2568')
assert.equal(parseThaiDateInput('02/08/2569'), '2026-08-02')
assert.equal(parseThaiDateInput('2-8-2569'), '2026-08-02')
assert.equal(parseThaiDateInput('2026-08-02'), '2026-08-02', 'ISO paste remains supported')
assert.equal(parseThaiDateInput('๐๒/๐๘/๒๕๖๙'), '2026-08-02', 'Thai digits are accepted')
assert.equal(parseThaiDateInput('31/02/2569'), null, 'invalid calendar dates are rejected')
assert.equal(parseThaiDateInput(''), '')
assert.equal(addIsoDays('2026-09-01', 1), '2026-09-02')
assert.equal(addIsoDays('2026-09-30', 1), '2026-10-01')
assert.equal(
  bangkokIsoDate(new Date('2026-08-10T18:00:00.000Z')),
  '2026-08-11',
  'business dates must follow Bangkok at the UTC day boundary',
)

const dateInput = readFileSync('components/ui/ThaiDateInput.tsx', 'utf8')
assert.match(dateInput, /พ\.ศ\./, 'date fields explain the Buddhist Era input format')
assert.match(dateInput, /parseThaiDateInput/, 'date fields emit parsed ISO values')
assert.match(dateInput, /CalendarPicker/, 'date fields must also offer a clickable calendar, not typing alone')
assert.match(dateInput, /minDate|props\.min/, 'date fields must pass their minimum date to the picker')
assert.match(dateInput, /showModal\(\)/, 'the calendar opens through a dialog, matching the app-dialog convention')

const calendarPicker = readFileSync('components/ui/CalendarPicker.tsx', 'utf8')
assert.match(calendarPicker, /aria-pressed/, 'calendar days must expose their selected state accessibly')
assert.match(calendarPicker, /min\?: string/, 'calendar picker must accept a minimum date')
assert.match(calendarPicker, /disabled=\{/, 'calendar picker must disable dates outside the allowed range')

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

const businessDateMigration = readFileSync(
  'supabase/migrations/20260811140000_bangkok_business_dates.sql',
  'utf8',
)
assert.match(businessDateMigration, /set timezone = 'Asia\/Bangkok'/i)
assert.match(businessDateMigration, /occurred_on set default public\.lab_stock_today\(\)/i)

const leaseSeed = readFileSync('scripts/staging-seed-lease-contract.mjs', 'utf8')
assert.match(leaseSeed, /timeZone:\s*'Asia\/Bangkok'/, 'staging fixtures must use the same business timezone')

console.log('Thai Buddhist Era dates: ok')
