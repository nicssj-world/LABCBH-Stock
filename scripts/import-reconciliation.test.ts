import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { buildImportPlan, reconcileImport, stableStringify } from '../lib/import/report'
import type { WorkbookSnapshot } from '../lib/import/types'

const sample: WorkbookSnapshot = {
  contracts: JSON.parse(readFileSync('fixtures/import/workbook-contracts.sample.json', 'utf8')),
  items: JSON.parse(readFileSync('fixtures/import/workbook-items.sample.json', 'utf8')),
}

const sampleReport = reconcileImport(buildImportPlan(sample))
assert.equal(sampleReport.conflicts.some(row => row.kind === 'name_variant'), true)
assert.equal(sampleReport.conflicts.some(row => row.kind === 'unit_variant'), true)
assert.equal(sampleReport.aliases.some(row => row.kind === 'ls_code'), true)
assert.ok(
  sampleReport.sourceCoordinates.some(
    source => source.spreadsheetId === 'items-sheet-sample' && source.tab === 'รายการน้ำยา' && source.row === 4,
  ),
)
assert.deepEqual(sampleReport.totals, { contractValue: 2290, legacyAllocatedQuantity: 60 })

const contractRows = Array.from({ length: 74 }, (_, index) => ({
  contractNumber: `LAB-${String(index + 1).padStart(3, '0')}/2569`,
  displayName: `สัญญา ${index + 1}`,
  vendor: 'ผู้ขายทดสอบ',
  fiscalYear: 2569,
  contractType: 'specific',
  product: `กลุ่ม ${index + 1}`,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  source: { spreadsheetId: 'baseline-contracts', tab: 'contracts', row: index + 2 },
}))
const itemRows = Array.from({ length: 289 }, (_, index) => {
  const lsIndex = index % 185
  return {
    contractNumber: `LAB-${String((index % 74) + 1).padStart(3, '0')}/2569`,
    lsCode: `LS${String(lsIndex + 1).padStart(6, '0')}`,
    name: `รายการ ${lsIndex + 1}`,
    unit: 'กล่อง',
    quantity: 1,
    unitPrice: 1,
    purchaseSequences: {},
    source: { spreadsheetId: 'baseline-items', tab: 'items', row: index + 2 },
  }
})

const baselineSnapshot: WorkbookSnapshot = {
  contracts: { spreadsheetId: 'baseline-contracts', tab: 'contracts', rows: contractRows },
  items: { spreadsheetId: 'baseline-items', tab: 'items', rows: itemRows },
}
const baselineReport = reconcileImport(buildImportPlan(baselineSnapshot), {
  contractNumbers: 74,
  itemRows: 289,
  uniqueLsCodes: 185,
})

assert.deepEqual(baselineReport.counts, {
  contractNumbers: 74,
  itemRows: 289,
  uniqueLsCodes: 185,
  legacyAllocations: 0,
})
assert.equal(baselineReport.comparisonWarnings.length, 0)

const changedReport = reconcileImport(buildImportPlan(sample), {
  contractNumbers: 74,
  itemRows: 289,
  uniqueLsCodes: 185,
})
assert.equal(changedReport.comparisonWarnings.length, 3)
assert.ok(stableStringify(changedReport).includes('expected'))
assert.ok(stableStringify(changedReport).includes('actual'))

const migrationNames = readdirSync('supabase/migrations').filter(name =>
  name.endsWith('_lab_stock_import_staging.sql'),
)
assert.equal(migrationNames.length, 1, 'import staging migration must be generated once by the CLI')
const migration = readFileSync(`supabase/migrations/${migrationNames[0]}`, 'utf8')
assert.match(migration, /create table if not exists public\.lab_stock_import_runs/i)
assert.match(migration, /create table if not exists public\.lab_stock_opening_count_batches/i)
assert.match(migration, /create or replace function public\.apply_lab_stock_import/i)
assert.match(migration, /create or replace function public\.apply_lab_stock_opening_counts/i)
assert.match(migration, /alter table public\.lab_stock_import_runs enable row level security/i)
assert.match(migration, /security invoker/i)
assert.match(migration, /revoke execute .* from public/i)
assert.match(migration, /grant execute .* to service_role/i)
assert.doesNotMatch(migration, /security definer/i)

const importCli = readFileSync('scripts/import-google-sheets.mts', 'utf8')
const reconcileCli = readFileSync('scripts/reconcile-import.mts', 'utf8')
assert.match(importCli, /--dry-run/)
assert.match(importCli, /--approved-hash/)
assert.match(importCli, /apply_lab_stock_import/)
assert.match(importCli, /apply_lab_stock_opening_counts/)
assert.match(importCli, /stableStringify/)
assert.doesNotMatch(importCli, /SERVICE_ROLE_KEY.*console/i)
assert.match(reconcileCli, /hashReconciliationReport/)
assert.match(reconcileCli, /reportHash/)

console.log('import reconciliation: ok')
