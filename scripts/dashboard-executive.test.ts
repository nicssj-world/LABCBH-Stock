import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import { aggregateExecutiveOverview } from '../lib/dashboard/executive'
import { generateExecutivePdf } from '../lib/dashboard/executive-pdf'
import { generateExecutiveWorkbook } from '../lib/dashboard/executive-excel'
import {
  contractMatchesExecutiveFollowUp,
  executiveSourceHref,
} from '../lib/dashboard/follow-up'
import { canClassifyExecutivePurchaseReceipt } from '../lib/dashboard/purchase-classification'

const overview = aggregateExecutiveOverview({
  fiscalYear: 2569,
  generatedOn: '2026-08-27',
  contracts: [
    {
      id: 10,
      displayName: 'สัญญาน้ำยาตรวจ',
      product: 'legacy supply',
      fiscalYear: 2569,
      contractType: 'e_bidding',
      contractNumber: 'SUP-01',
      durationYears: 1,
      status: 'active',
      total: 10000,
      startDate: '2025-10-01',
      endDate: '2026-09-30',
      department: 'งานเคมีคลินิก',
      usages: [],
    },
    {
      id: 20,
      displayName: 'เช่าเครื่อง Hematology',
      product: 'lease',
      fiscalYear: 2568,
      contractType: 'equipment_lease',
      contractNumber: 'LEASE-1',
      durationYears: 1,
      status: 'active',
      total: 50000,
      startDate: '2025-10-01',
      endDate: '2026-09-30',
      department: 'งานโลหิตวิทยา',
      usages: [
        { amount: 100, usageMonth: '2025-10' },
        { amount: 30, usageMonth: '2026-01-01' },
      ],
    },
    {
      id: 21,
      displayName: 'เช่าเครื่อง Chemistry',
      product: 'lease',
      fiscalYear: 2569,
      contractType: 'equipment_lease',
      contractNumber: 'LEASE-3',
      durationYears: 3,
      status: 'active',
      total: 100000,
      startDate: '2025-10-01',
      endDate: '2028-09-30',
      department: 'งานเคมีคลินิก',
      usages: [{ amount: 200, usageMonth: '2026-02' }],
    },
  ],
  receipts: [
    {
      id: 'receipt-posted',
      fiscalYear: 2569,
      purchaseRequestId: 'pr-1',
      receivedDate: '2025-11-15',
      status: 'posted',
      items: [{ inventoryItemId: 'item-1', quantity: 10 }],
    },
    {
      id: 'receipt-annual-plan',
      fiscalYear: 2569,
      purchaseRequestId: 'pr-annual',
      receivedDate: '2026-01-15',
      status: 'posted',
      items: [{ inventoryItemId: 'item-annual', quantity: 2 }],
    },
    {
      id: 'receipt-draft',
      fiscalYear: 2569,
      purchaseRequestId: 'pr-1',
      receivedDate: '2025-12-15',
      status: 'draft',
      items: [{ inventoryItemId: 'item-1', quantity: 100 }],
    },
    {
      id: 'receipt-unlinked',
      fiscalYear: 2569,
      purchaseRequestId: null,
      receivedDate: '2026-03-15',
      status: 'posted',
      items: [{ inventoryItemId: 'item-unknown', quantity: 1 }],
    },
  ],
  purchaseRequestItems: [{
    purchaseRequestId: 'pr-1',
    inventoryItemId: 'item-1',
    itemName: 'น้ำยาตรวจ',
    unitPrice: 50,
    contractItemId: 'line-1',
    contractId: 10,
    purchaseMethod: 'contract',
  }, {
    purchaseRequestId: 'pr-annual',
    inventoryItemId: 'item-annual',
    itemName: 'น้ำยาตามแผนจัดซื้อ',
    unitPrice: 25,
    contractItemId: null,
    contractId: null,
    purchaseMethod: 'annual_plan',
  }],
  servicePlans: [{ id: 'plan-1', fiscalYear: 2569, name: 'งานตรวจวิเคราะห์', department: 'ห้องปฏิบัติการ' }],
  serviceLedger: [
    { id: 'reservation', planId: 'plan-1', entryKind: 'reservation', amount: 9999, eventDate: '2025-10-01', purchaseRequestId: null, sourceReference: null },
    { id: 'expense', planId: 'plan-1', entryKind: 'expense', amount: 300, eventDate: '2025-11-01', purchaseRequestId: 'spr-1', sourceReference: 'SPR-1' },
    { id: 'reversal', planId: 'plan-1', entryKind: 'expense_reversal', amount: -50, eventDate: '2026-04-01', purchaseRequestId: 'spr-1', sourceReference: 'SPR-1' },
  ],
})

assert.deepEqual(overview.spend, {
  purchase: 550,
  service: 250,
  lease: 330,
  hiringTotal: 580,
  total: 1130,
})
assert.equal(overview.priorYearSpend.total, 0)
assert.equal(overview.comparison.trend, 'no-baseline')
assert.equal(overview.monthly.find((row) => row.month === '2025-10')?.lease, 100)
assert.equal(overview.monthly.find((row) => row.month === '2026-02')?.lease, 200)
assert.deepEqual(overview.leaseDurationSummary.map((row) => ({ years: row.durationYears, count: row.contractCount, expense: row.expense })), [
  { years: 1, count: 1, expense: 130 },
  { years: 3, count: 1, expense: 200 },
])
assert.equal(overview.leaseContracts.find((contract) => contract.contractId === 20)?.startDate, '2025-10-01')
assert.equal(overview.leaseContracts.find((contract) => contract.contractId === 20)?.endDate, '2026-09-30')
assert.equal(overview.categories.find((row) => row.key === 'hiring')?.amount, 580)
assert.equal(overview.categories.find((row) => row.key === 'lease')?.amount, 330)
assert.equal(overview.dataQuality.unclassifiedReceiptCount, 1)
assert.equal(overview.dataQuality.missingReceiptPriceCount, 0)
assert.deepEqual(overview.purchaseSourceRows.find((row) => row.purchaseRequestId === 'pr-annual'), {
  receiptId: 'receipt-annual-plan',
  receivedDate: '2026-01-15',
  purchaseRequestId: 'pr-annual',
  itemName: 'น้ำยาตามแผนจัดซื้อ',
  quantity: 2,
  unitPrice: 25,
  amount: 50,
  contractId: null,
  contractName: null,
})
assert.equal(canClassifyExecutivePurchaseReceipt('annual_plan', null, null), true)
assert.equal(canClassifyExecutivePurchaseReceipt('contract', null, null), false)

assert.equal(
  executiveSourceHref(2569, 'receiving-data-quality'),
  '/receipts?issue=receiving-data-quality&fiscalYear=2569',
)
assert.equal(
  executiveSourceHref(2569, 'pending-contracts'),
  '/contracts?issue=pending-contracts&followUpYear=2569',
)
assert.equal(contractMatchesExecutiveFollowUp({
  contractType: 'equipment_lease',
  fiscalYear: 2568,
  durationYears: 1,
  status: 'active',
  total: 100000,
  startDate: '2025-10-01',
  endDate: '2028-09-30',
  usages: [{ amount: 10, usageMonth: null }],
}, 'lease-usage-data-quality', 2569), true)
assert.equal(contractMatchesExecutiveFollowUp({
  contractType: 'e_bidding',
  fiscalYear: 2569,
  durationYears: 1,
  status: 'pending',
  total: 100000,
  startDate: null,
  endDate: null,
  usages: [],
}, 'pending-contracts', 2569), true)
assert.equal(contractMatchesExecutiveFollowUp({
  contractType: 'e_bidding',
  fiscalYear: 2568,
  durationYears: 1,
  status: 'pending',
  total: 100000,
  startDate: null,
  endDate: null,
  usages: [],
}, 'pending-contracts', 2569), false)

async function runExportAssertions() {
  const manyContracts = Array.from({ length: 28 }, (_, index) => ({
    ...overview.leaseContracts[0],
    contractId: 9000 + index,
    contractName: `สัญญาเช่าเครื่องรายการที่ ${index + 1}`,
  }))
  const paginatedPdf = await generateExecutivePdf({ ...overview, leaseContracts: manyContracts })
  assert.equal(new TextDecoder().decode(paginatedPdf.slice(0, 5)), '%PDF-')
  assert.ok((await PDFDocument.load(paginatedPdf)).getPageCount() >= 6, 'lease details must continue onto additional PDF pages')

  const workbookBytes = await generateExecutiveWorkbook(overview)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(workbookBytes as unknown as ArrayBuffer)
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Summary',
    'Monthly Spend',
    'Procurement Categories',
    'Equipment Lease Duration',
    'Equipment Lease Contracts',
    'Alerts & Data Quality',
    'Source Details',
  ])
  const leaseSheet = workbook.getWorksheet('Equipment Lease Contracts')!
  assert.equal(leaseSheet.getRow(1).getCell(4).value, 'วันที่เริ่ม')
  assert.equal(leaseSheet.getRow(1).getCell(5).value, 'วันที่สิ้นสุด')
  const oneYearRow = leaseSheet.getRows(2, leaseSheet.rowCount - 1)?.find((row) => row?.getCell(2).value === 'LEASE-1')
  if (!oneYearRow) throw new Error('one-year lease row was not exported')
  assert.equal(oneYearRow.getCell(4).value, '1 ต.ค. 2568')
  assert.equal(oneYearRow.getCell(5).value, '30 ก.ย. 2569')

  const page = readFileSync('app/(protected)/dashboard/page.tsx', 'utf8')
  assert.match(page, /view=executive/)
  assert.match(page, /ExecutiveFiscalYearFilter/)
  assert.match(page, /ExecutiveDashboardView/)
  const executiveQueries = readFileSync('lib/dashboard/executive.ts', 'utf8')
  assert.match(executiveQueries, /purchase_method/, 'executive purchase totals must read the PR purchase method')
  assert.match(executiveQueries, /canClassifyExecutivePurchaseReceipt/, 'executive purchase totals must share the receipt classification rule')
  const route = readFileSync('app/api/dashboard/executive/export/route.ts', 'utf8')
  assert.match(route, /format: z\.enum\(\['pdf', 'xlsx'\]\)/)
  assert.match(route, /generateExecutivePdf/)
  assert.match(route, /generateExecutiveWorkbook/)
  const leaseView = readFileSync('components/dashboard/ExecutiveLeaseTable.tsx', 'utf8')
  assert.match(leaseView, /วันที่เริ่ม/)
  assert.match(leaseView, /วันที่สิ้นสุด/)
  assert.match(leaseView, /PAGE_SIZE/)
  const followUpPage = readFileSync('app/(protected)/dashboard/follow-up/page.tsx', 'utf8')
  assert.match(followUpPage, /executiveSourceHref/, 'follow-up actions must open the underlying filtered register')
  assert.match(followUpPage, /isCurrentCategory/, 'the current follow-up filter must not render a self-link')
  assert.match(followUpPage, /กลับไปดูรายการทั้งหมด/, 'an already-filtered queue must offer a link back to all issues')
  assert.match(followUpPage, /เปิดทะเบียนสัญญาที่พบ|เปิดรายการรับเข้าที่พบ/, 'follow-up actions must identify the filtered source list')
  const contractPage = readFileSync('app/(protected)/contracts/page.tsx', 'utf8')
  assert.match(contractPage, /contractMatchesExecutiveFollowUp/, 'contract source links must apply the same issue predicate as the alert')
  const receiptPage = readFileSync('app/(protected)/receipts/page.tsx', 'utf8')
  assert.match(receiptPage, /dataQualityOnly/, 'receipt source links must apply the data-quality filter')

  console.log('executive dashboard aggregation and export: ok')
}

runExportAssertions().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
