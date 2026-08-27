import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { buildInventoryPdfModel, generateInventoryPdf } from '../lib/inventory/export'
import { inventoryExportFiltersSchema } from '../lib/inventory/schema'

const read = (path: string) => readFileSync(path, 'utf8')

const filters = inventoryExportFiltersSchema.parse({ department: '  งานเคมีคลินิก  ' })
assert.deepEqual(filters, { department: 'งานเคมีคลินิก', onlyInStock: false })
assert.deepEqual(inventoryExportFiltersSchema.parse({ onlyInStock: true }), {
  onlyInStock: true,
})

const items = [
  {
    id: 'item-1',
    lsCode: 'LS-001',
    name: 'น้ำยาทดสอบหลายล็อต',
    baseUnit: 'ขวด',
    responsibleDepartment: 'งานเคมีคลินิก',
    note: 'เก็บในตู้เย็น',
    onHand: 8,
    lots: [
      { id: 'lot-1', lotNumber: 'A-001', expiryDate: '2027-01-01', balance: 5, isActive: true },
      { id: 'lot-2', lotNumber: 'A-002', expiryDate: '2027-02-01', balance: 3, isActive: true },
    ],
  },
  {
    id: 'item-2',
    lsCode: 'LS-002',
    name: 'น้ำยาล็อตเดียว',
    baseUnit: 'กล่อง',
    responsibleDepartment: null,
    note: null,
    onHand: 0,
    lots: [{ id: 'lot-3', lotNumber: 'B-001', expiryDate: null, balance: 0, isActive: true }],
  },
]

const model = buildInventoryPdfModel({
  items,
  department: 'งานเคมีคลินิก',
  onlyInStock: false,
  generatedOn: '2026-08-26',
})
assert.equal(model.itemCount, 2)
assert.deepEqual(model.rows.map((row) => row.kind), ['item', 'lot', 'lot', 'item'])
assert.equal(model.rows[0].lotCount, 2)
assert.equal(model.rows[1].name, '')
assert.equal(model.rows[1].lotNumber, 'A-001')
assert.equal(model.rows[1].expiryDate, '2027-01-01')
assert.equal(model.rows[1].balance, 5)
assert.equal(model.rows[0].note, 'เก็บในตู้เย็น')
assert.equal(model.rows[1].note, null, 'lot detail rows do not repeat the item note')
assert.equal(model.rows[3].expiryDate, null, 'a zero-balance single lot stays summarized on the item row')
assert.equal(model.rows[3].lotNumber, 'B-001', 'a single lot stays summarized on the item row')

async function runPdfAssertions() {
  const pdf = await generateInventoryPdf({
    items,
    department: 'งานเคมีคลินิก',
    onlyInStock: false,
    generatedOn: '2026-08-26',
  })
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), '%PDF-')
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1)

  const manyItems = Array.from({ length: 45 }, (_, index) => ({
    ...items[0],
    id: `item-${index + 10}`,
    lsCode: `LS-${index + 10}`,
    name: `รายการทดสอบที่ ${index + 10}`,
    lots: [],
  }))
  const paginatedPdf = await generateInventoryPdf({
    items: manyItems,
    department: null,
    onlyInStock: true,
    generatedOn: '2026-08-26',
  })
  assert.ok((await PDFDocument.load(paginatedPdf)).getPageCount() > 1, 'large reports must paginate')

  const listPage = read('app/(protected)/inventory/page.tsx')
  assert.match(listPage, /InventoryExportDialog/)
  const dialog = read('components/inventory/InventoryExportDialog.tsx')
  assert.match(dialog, /Export คงคลังเป็น PDF/)
  assert.match(dialog, /ทุกหน่วยงาน/)
  assert.match(dialog, /onlyInStock/)
  assert.match(dialog, /มีอยู่ในคลัง/)

  const queries = read('lib/inventory/queries.ts')
  assert.match(queries, /listInventoryExportItems/)
  assert.match(queries, /inventory_lot_balances/)
  assert.match(queries, /filters\.onlyInStock/)

  const route = read('app/api/inventory/export/route.ts')
  assert.match(route, /inventoryExportFiltersSchema/)
  assert.match(route, /generateInventoryPdf/)
  assert.match(route, /Content-Disposition.*attachment/)

  const exportSource = read('lib/inventory/export.ts')
  assert.doesNotMatch(exportSource, /key: 'department'/, 'the PDF table must not repeat the department column')
  assert.match(exportSource, /key: 'name'[^\n]*\n\s*\{ key: 'lot'/, 'the Lot column must follow the item name')
  assert.match(exportSource, /case 'lot'/, 'the PDF rows must render lot numbers in the Lot column')
  assert.match(exportSource, /key: 'balance'[\s\S]*key: 'note'/, 'the note column must follow remaining balance')
  assert.match(exportSource, /case 'note'/, 'the PDF rows must render item notes')

  console.log('inventory export: ok')
}

runPdfAssertions().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
