import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyImportPlan,
  buildImportPlan,
  hashReconciliationReport,
  reconcileImport,
  stableStringify,
} from '../lib/import/report'
import { mapWorkbookRows } from '../lib/import/files'
import {
  buildOpeningCountPlan,
  hashOpeningCountPlan,
  parseOpeningCountCsv,
} from '../lib/import/opening-count'
import type { WorkbookSnapshot } from '../lib/import/types'

async function main() {
  const contracts = JSON.parse(
    readFileSync('fixtures/import/workbook-contracts.sample.json', 'utf8'),
  )
  const items = JSON.parse(readFileSync('fixtures/import/workbook-items.sample.json', 'utf8'))

  const snapshot: WorkbookSnapshot = { contracts, items }
  const reversed: WorkbookSnapshot = {
    contracts: { ...contracts, rows: [...contracts.rows].reverse() },
    items: { ...items, rows: [...items.rows].reverse() },
  }

  const firstPlan = buildImportPlan(snapshot)
  const secondPlan = buildImportPlan(reversed)

  assert.equal(stableStringify(firstPlan), stableStringify(secondPlan))
  assert.equal(firstPlan.contracts.length, 2)
  assert.equal(firstPlan.contractItems.length, 2)
  assert.equal(firstPlan.inventoryItems.length, 1, 'LS variants collapse into one catalog item')
  assert.equal(firstPlan.legacyAllocations.length, 3)
  assert.ok(firstPlan.legacyAllocations.every(row => row.sourceIdentity.includes('items-sheet-sample')))
  assert.ok(
    firstPlan.warnings.some(row => row.kind === 'broken_stock_formula' && row.source.row === 3),
    'broken Sheet balances are reported but never imported',
  )
  assert.ok(!stableStringify(firstPlan).includes('#REF!'))

  const report = reconcileImport(firstPlan)
  const reportHash = hashReconciliationReport(report)
  const repeatedHash = hashReconciliationReport(reconcileImport(secondPlan))
  assert.equal(reportHash, repeatedHash)
  assert.equal(Object.isFrozen(report), true)
  assert.equal(Object.isFrozen(report.counts), true)

  const dryRun = await applyImportPlan(firstPlan, true)
  assert.deepEqual(dryRun, { applied: false, reportHash, mode: 'dry-run' })
  await assert.rejects(() => applyImportPlan(firstPlan, false), /approved report hash/i)

  let applied = 0
  const applyResult = await applyImportPlan(firstPlan, false, {
    approvedReportHash: reportHash,
    actorId: '11111111-1111-4111-8111-111111111111',
    apply: async plan => {
      applied += 1
      assert.equal(stableStringify(plan), stableStringify(firstPlan))
      return { importRunId: '22222222-2222-4222-8222-222222222222' }
    },
  })
  assert.equal(applied, 1)
  assert.deepEqual(applyResult, {
    applied: true,
    reportHash,
    mode: 'apply',
    importRunId: '22222222-2222-4222-8222-222222222222',
  })

  const comparedReport = reconcileImport(firstPlan, {
    contractNumbers: 74,
    itemRows: 289,
    uniqueLsCodes: 185,
  })
  const comparedHash = hashReconciliationReport(comparedReport)
  const comparedApply = await applyImportPlan(firstPlan, false, {
    approvedReportHash: comparedHash,
    actorId: '11111111-1111-4111-8111-111111111111',
    report: comparedReport,
    apply: async () => ({ importRunId: '33333333-3333-4333-8333-333333333333' }),
  })
  assert.equal(comparedApply.reportHash, comparedHash)

  const mappedItems = mapWorkbookRows(
    [
      ['เลขที่สัญญา', 'รหัส LS', 'ชื่อรายการ', 'หน่วย', 'จำนวน', 'ราคาต่อหน่วย', 'คงเหลือ', 'ครั้งที่ 1'],
      ['กค 12/2569', 'ls046022', 'น้ำยา Alpha', 'กล่อง', 10, 25, '#REF!', 4],
    ],
    'items',
    { spreadsheetId: 'xlsx-sample', tab: 'รายการ' },
  )
  assert.equal(mappedItems.rows.length, 1)
  assert.deepEqual(mappedItems.rows[0]?.purchaseSequences, { 'ครั้งที่ 1': 4 })
  assert.equal(mappedItems.rows[0]?.source.cells?.lsCode, 'B2')

  const openingCsv = [
    'ls_code,lot_number,expiry_date,quantity,storage_location,count_date,approver_id',
    'LS046022,OPEN-001,2027-12-31,12.5,"ตู้เย็น, ชั้น 1",2026-07-30,11111111-1111-4111-8111-111111111111',
  ].join('\n')
  const openingPlan = buildOpeningCountPlan(parseOpeningCountCsv(openingCsv))
  assert.equal(openingPlan.rows[0]?.quantity, 12.5)
  assert.equal(openingPlan.rows[0]?.storageLocation, 'ตู้เย็น, ชั้น 1')
  assert.equal(hashOpeningCountPlan(openingPlan), hashOpeningCountPlan(buildOpeningCountPlan(parseOpeningCountCsv(openingCsv))))
  assert.throws(
    () => buildOpeningCountPlan(parseOpeningCountCsv(openingCsv.replace('12.5', '#REF!'))),
    /opening count quantity/i,
  )

  console.log('import idempotency: ok')
}

void main()
