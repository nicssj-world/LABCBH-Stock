import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import {
  buildServiceInvoiceSummaryModel,
  formatThaiLongDate,
  formatThaiNumericDate,
  generateServiceInvoiceSummaryPdf,
  type ServiceInvoiceSummaryInput,
} from '../lib/service-procurement/invoice-summary'

const redCrossRequest: ServiceInvoiceSummaryInput = {
  isRedCross: true,
  documentNumber: 'SPR-2569-0001',
  invoiceSummaryNumber: '01/2569',
  planName: 'ทดสอบที่มีรายการ',
  poNumber: 'จ.1335/2569',
  usageStartDate: '2026-06-01',
  usageEndDate: '2026-06-15',
  items: [{ unit: 'ราย', unitPrice: 310 }],
  usageEvents: [
    { kind: 'lab_expense', status: 'active', expenseDate: '2026-06-02', amount: 310, invoiceNumber: 'I-002', createdAt: '2026-06-02T10:00:00+07:00' },
    { kind: 'lab_expense', status: 'cancelled', expenseDate: '2026-06-03', amount: 620, invoiceNumber: 'I-CANCELLED', createdAt: '2026-06-03T10:00:00+07:00' },
    { kind: 'annual_usage', status: 'active', expenseDate: '2026-06-04', amount: 999, invoiceNumber: null, createdAt: '2026-06-04T10:00:00+07:00' },
    { kind: 'lab_expense', status: 'active', expenseDate: '2026-06-01', amount: 20150, invoiceNumber: 'I-001', createdAt: '2026-06-01T10:00:00+07:00' },
  ],
}

const model = buildServiceInvoiceSummaryModel(redCrossRequest)
assert.equal(model.invoiceSummaryNumber, '01/2569')
assert.equal(model.dateRangeLabel, 'วันที่ 1 มิถุนายน 2569 - 15 มิถุนายน 2569')
assert.equal(formatThaiLongDate('2026-06-01'), '1 มิถุนายน 2569')
assert.equal(formatThaiNumericDate('2026-06-01'), '01/06/2569')
assert.deepEqual(model.rows.map((row) => ({
  sequence: row.sequence,
  invoiceNumber: row.invoiceNumber,
  amount: row.amount,
  people: row.people,
})), [
  { sequence: 1, invoiceNumber: 'I-001', amount: 20150, people: 65 },
  { sequence: 2, invoiceNumber: 'I-002', amount: 310, people: 1 },
])
assert.equal(model.totalAmount, 20460)
assert.equal(model.totalPeople, 66)
assert.equal(model.rows[0]?.poNumber, 'จ.1335/2569')
assert.equal(model.rows[1]?.poNumber, null)

const noPeopleUnit = buildServiceInvoiceSummaryModel({
  ...redCrossRequest,
  items: [{ unit: 'ชุด', unitPrice: 310 }],
})
assert.equal(noPeopleUnit.peopleUnitPrice, null)
assert.deepEqual(noPeopleUnit.rows.map((row) => row.people), [null, null])
assert.throws(
  () => buildServiceInvoiceSummaryModel({ ...redCrossRequest, isRedCross: false }),
  /เฉพาะ PR งานจ้างที่ติด tag สภากาชาดไทย/,
)

const thirtyFiveRowRequest: ServiceInvoiceSummaryInput = {
  ...redCrossRequest,
  usageEvents: Array.from({ length: 35 }, (_, index) => ({
    kind: 'lab_expense' as const,
    status: 'active' as const,
    expenseDate: '2026-06-01',
    amount: 100 + index,
    invoiceNumber: `I-30-${String(index + 1).padStart(2, '0')}`,
    createdAt: `2026-06-01T${String(index % 24).padStart(2, '0')}:00:00+07:00`,
  })),
}

async function run() {
  const pdf = await generateServiceInvoiceSummaryPdf(redCrossRequest)
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), '%PDF-')
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1)

  const thirtyFiveRowPdf = await generateServiceInvoiceSummaryPdf(thirtyFiveRowRequest)
  assert.equal((await PDFDocument.load(thirtyFiveRowPdf)).getPageCount(), 1, 'invoice summary must fit at least 35 rows on one A4 page')

  console.log('service invoice summary: ok')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
