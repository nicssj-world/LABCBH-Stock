import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { buildInventoryAnnualReportModel, generateInventoryAnnualReportWorkbook } from '../lib/inventory/annual-report'
import { fiscalYearBounds } from '../lib/annual-plans/fiscal'
import { inventoryAnnualReportFiltersSchema } from '../lib/inventory/schema'

const read = (path: string) => readFileSync(path, 'utf8')

assert.deepEqual(inventoryAnnualReportFiltersSchema.parse({ fiscalYear: '2568', department: '  งานเคมีคลินิก  ' }), {
  fiscalYear: 2568,
  department: 'งานเคมีคลินิก',
})
assert.deepEqual(fiscalYearBounds(2568), { startDate: '2024-10-01', endDate: '2025-09-30' })

const model = buildInventoryAnnualReportModel({
  fiscalYear: 2568,
  generatedOn: '2025-05-01',
  department: 'งานเคมีคลินิก',
  items: [
    {
      id: 'item-1',
      lsCode: 'LS-001',
      name: 'น้ำยาตรวจ',
      baseUnit: 'ขวด',
      responsibleDepartment: 'งานเคมีคลินิก',
      defaultUnitPrice: 12.5,
      note: 'เก็บในตู้เย็น',
      isActive: true,
    },
    {
      id: 'item-2',
      lsCode: 'LS-002',
      name: 'รายการปิดใช้งาน',
      baseUnit: 'กล่อง',
      responsibleDepartment: 'งานเคมีคลินิก',
      defaultUnitPrice: null,
      note: null,
      isActive: false,
    },
  ],
  movements: [
    { inventoryItemId: 'item-1', movementType: 'opening_adjustment', quantity: 10, occurredOn: '2024-09-30' },
    { inventoryItemId: 'item-1', movementType: 'goods_receipt', quantity: 5, occurredOn: '2024-10-01' },
    { inventoryItemId: 'item-1', movementType: 'requisition_issue', quantity: -3, occurredOn: '2025-01-05' },
    { inventoryItemId: 'item-1', movementType: 'manual_adjustment', quantity: 1, occurredOn: '2025-02-01' },
    { inventoryItemId: 'item-1', movementType: 'manual_adjustment', quantity: -0.5, occurredOn: '2025-03-01' },
    { inventoryItemId: 'item-1', movementType: 'goods_receipt', quantity: 4, occurredOn: '2025-10-01' },
  ],
})

assert.equal(model.departmentLabel, 'งานเคมีคลินิก')
assert.deepEqual(model.items[0], {
  id: 'item-1',
  lsCode: 'LS-001',
  name: 'น้ำยาตรวจ',
  baseUnit: 'ขวด',
  openingBalance: 10,
  receivedDuringYear: 6,
  totalReceived: 16,
  issuedDuringYear: 3.5,
  closingBalance: 12.5,
  latestUnitPrice: 12.5,
  totalValue: 156.25,
  note: 'เก็บในตู้เย็น · มีการปรับยอดใน ledger',
})
assert.equal(model.items[1].closingBalance, 0, 'items without movements remain in the annual register')
assert.equal(model.items[1].note, 'ปิดใช้งาน')
assert.equal(model.totalValue, 156.25)

async function runExportAssertions() {
  const workbookBytes = await generateInventoryAnnualReportWorkbook(model)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(workbookBytes as unknown as ArrayBuffer)

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['เทคนิคการแพทย์'])
  const sheet = workbook.getWorksheet('เทคนิคการแพทย์')!
  assert.equal(sheet.getCell('B1').value, 'รายงานตรวจสอบพัสดุประจำปีงบประมาณ 2568 โรงพยาบาลชลบุรี')
  assert.equal(sheet.getCell('B3').value, 'วันที่ 1 ต.ค. 2567 ถึงวันที่ 30 ก.ย. 2568')
  assert.equal(sheet.getCell('D4').value, 'ข้อมูล ณ วันที่ 1 พ.ค. 2568')
  assert.equal(sheet.getCell('D4').alignment?.horizontal, 'right')
  assert.equal(sheet.getCell('B5').value, 'รหัสพัสดุ')
  assert.equal(sheet.getCell('C5').value, 'รายการ')
  assert.equal(sheet.getCell('E5').value, 'ปีงบประมาณ 2567')
  assert.equal(sheet.getCell('F5').value, 'ปีงบประมาณ 2568')
  assert.equal(sheet.getCell('I5').value, 'คงเหลือสิ้นปีงบประมาณ 2568')
  assert.equal(sheet.getCell('M5').value, 'itemcode')
  assert.equal(sheet.getColumn(13).hidden, true)
  assert.equal(sheet.pageSetup.orientation, 'portrait')
  assert.equal(sheet.pageSetup.paperSize, 9)
  assert.equal(sheet.pageSetup.printTitlesRow, '1:6')
  assert.ok(sheet.model.merges.includes('A5:A6'))
  assert.ok(sheet.model.merges.includes('I5:K5'))
  assert.ok(sheet.model.merges.includes('D4:L4'))
  assert.ok(sheet.model.merges.includes('B1:M1'))

  const firstItemRow = sheet.getRow(7)
  assert.equal(firstItemRow.getCell(2).value, 'LS-001')
  assert.equal(firstItemRow.getCell(2).alignment?.horizontal, 'center')
  assert.equal(firstItemRow.getCell(12).border.left?.style, 'thin')
  assert.equal(firstItemRow.getCell(12).border.bottom?.style, 'thin')
  assert.equal(firstItemRow.getCell(5).value, 10)
  assert.equal(firstItemRow.getCell(6).value, 6)
  assert.equal(firstItemRow.getCell(5).numFmt, '#,##0;(#,##0);0')
  assert.equal(firstItemRow.getCell(8).numFmt, '#,##0.###')
  assert.deepEqual(firstItemRow.getCell(7).value, { formula: 'ROUND(E7+F7,3)', result: 16 })
  assert.equal(firstItemRow.getCell(8).value, 3.5)
  assert.deepEqual(firstItemRow.getCell(9).value, { formula: 'ROUND(G7-H7,3)', result: 12.5 })
  assert.deepEqual(firstItemRow.getCell(11).value, {
    formula: 'IF(J7="","",ROUND(I7*J7,2))',
    result: 156.25,
  })
  assert.equal(firstItemRow.getCell(10).numFmt, '#,##0.##;(#,##0.##);-')
  assert.equal(sheet.getCell('M7').value, 'LS-001')

  const totalRow = sheet.getRow(9)
  assert.equal(totalRow.getCell(3).value, 'รวมจำนวนเงินทั้งสิ้น')
  assert.deepEqual(totalRow.getCell(11).value, { formula: 'SUM(K7:K8)', result: 156.25 })

  const page = read('app/(protected)/inventory/page.tsx')
  assert.match(page, /InventoryAnnualReportExportDialog/)
  const dialog = read('components/inventory/InventoryAnnualReportExportDialog.tsx')
  assert.match(dialog, /Export รายงานประจำปี/)
  assert.match(dialog, /สร้าง Excel/)
  assert.match(dialog, /fiscalYear/)
  assert.match(dialog, /ทุกหน่วยงาน/)

  const route = read('app/api/inventory/annual-report/export/route.ts')
  assert.match(route, /inventoryAnnualReportFiltersSchema/)
  assert.match(route, /generateInventoryAnnualReportWorkbook/)
  assert.match(route, /Content-Disposition.*attachment/)

  // The pre-existing PDF export remains a separate UI and API path.
  assert.match(read('components/inventory/InventoryExportDialog.tsx'), /Export PDF/)
  assert.match(read('app/api/inventory/export/route.ts'), /generateInventoryPdf/)

  console.log('inventory annual report export: ok')
}

runExportAssertions().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
