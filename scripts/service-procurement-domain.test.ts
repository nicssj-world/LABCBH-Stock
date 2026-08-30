import assert from 'node:assert/strict'
import {
  deriveServiceChecklist,
  servicePlanHistoricalExpenseSchema,
  servicePurchaseRequestInputSchema,
  servicePlanInputSchema,
} from '@/lib/service-procurement/schema'
import {
  calculateAnnualRequestTotal,
  calculateServiceRequestTotal,
  deriveServiceFulfillment,
  isDateRangeWithinFiscalYear,
  serviceRequestMatchesDisplayStatus,
  SERVICE_REQUEST_FILTER_STATUSES,
  fiscalYearFromDate,
  fiscalYearRange,
  formatServiceRequestNumber,
  planBalance,
  servicePlanAverageMonthly,
  servicePlanExpenseMonthOptions,
  servicePlanMonthlySeries,
} from '@/lib/service-procurement/domain'
import {
  DUPLICATE_SERVICE_INVOICE_MESSAGE,
  hasDuplicateServiceInvoice,
  isDuplicateServiceInvoiceError,
  normalizeServiceInvoice,
} from '@/lib/service-procurement/invoice'

assert.equal(fiscalYearFromDate('2025-09-30'), 2568)
assert.equal(fiscalYearFromDate('2025-10-01'), 2569)
assert.equal(fiscalYearFromDate('2026-09-30'), 2569)
assert.equal(fiscalYearFromDate('2026-10-01'), 2570)
assert.deepEqual(fiscalYearRange(2569), { start: '2025-10-01', end: '2026-09-30' })
assert.equal(formatServiceRequestNumber(2569, 7), 'SPR-2569-0007')
assert.equal(isDateRangeWithinFiscalYear('2026-09-01', '2026-09-01', 2569), false)
assert.equal(isDateRangeWithinFiscalYear('2026-09-01', '2026-09-02', 2569), true)
assert.deepEqual(SERVICE_REQUEST_FILTER_STATUSES, [
  'pending_confirmation',
  'awaiting_po',
  'ready_for_expense',
  'recording_expense',
  'closed',
  'cancelled',
])
const incompletePoRequest = {
  status: 'confirmed' as const,
  poStatus: 'open' as const,
  poNumber: 'PO-001',
  poFileName: null,
  usageEvents: [],
}
assert.equal(serviceRequestMatchesDisplayStatus(incompletePoRequest, 'awaiting_po'), true)
assert.equal(serviceRequestMatchesDisplayStatus(incompletePoRequest, 'ready_for_expense'), false)

assert.equal(normalizeServiceInvoice('  INV-001  '), 'inv-001')
assert.equal(normalizeServiceInvoice('   '), null)
const invoiceEvents = [
  { id: 'active-1', kind: 'lab_expense' as const, status: 'active' as const, invoiceNumber: 'INV-001' },
  { id: 'cancelled-1', kind: 'lab_expense' as const, status: 'cancelled' as const, invoiceNumber: 'INV-002' },
  { id: 'usage-1', kind: 'annual_usage' as const, status: 'active' as const, invoiceNumber: 'INV-003' },
]
assert.equal(hasDuplicateServiceInvoice(invoiceEvents, ' inv-001 '), true)
assert.equal(hasDuplicateServiceInvoice(invoiceEvents, 'INV-002'), false)
assert.equal(hasDuplicateServiceInvoice(invoiceEvents, 'INV-003'), false)
assert.equal(hasDuplicateServiceInvoice(invoiceEvents, 'INV-001', 'active-1'), false)
assert.equal(hasDuplicateServiceInvoice(invoiceEvents, 'INV-004'), false)
assert.equal(isDuplicateServiceInvoiceError({ code: '23505', message: 'duplicate key violates service_purchase_request_expenses_invoice_unique' }), true)
assert.equal(isDuplicateServiceInvoiceError({ code: '23505', message: 'duplicate key violates another_constraint' }), false)
assert.equal(DUPLICATE_SERVICE_INVOICE_MESSAGE, 'เลข Invoice นี้ถูกใช้แล้วในใบ PR นี้ กรุณาตรวจสอบเลข Invoice')

assert.equal(calculateAnnualRequestTotal([
  { requestedQuantity: 2, unitPrice: 125.5 },
  { requestedQuantity: 3, unitPrice: 10 },
]), 281)
assert.equal(calculateServiceRequestTotal([
  { requestedQuantity: 20, unitPrice: 3000 },
  { requestedQuantity: 20, unitPrice: 1500 },
  { requestedQuantity: 20, unitPrice: 2000 },
  { requestedQuantity: 20, unitPrice: 2000 },
  { requestedQuantity: 20, unitPrice: 4000 },
]), 250_000)

assert.deepEqual(planBalance({ budget: 1000, spent: 250, reserved: 300 }), {
  budget: 1000,
  spent: 250,
  reserved: 300,
  available: 450,
})

assert.equal(deriveServiceFulfillment(10, 0), 'not_started')
assert.equal(deriveServiceFulfillment(10, 5), 'partial')
assert.equal(deriveServiceFulfillment(10, 10), 'complete')

const monthlySeries = servicePlanMonthlySeries(2569, [
  { eventDate: '2025-10-10', entryKind: 'historical_expense', amount: 100 },
  { eventDate: '2025-10-20', entryKind: 'reservation', amount: 500 },
  { eventDate: '2026-01-03', entryKind: 'expense', amount: 50 },
], new Date('2026-08-27T00:00:00+07:00'))
assert.equal(monthlySeries.find((entry) => entry.month === '2025-10-01')?.amount, 100)
assert.equal(monthlySeries.find((entry) => entry.month === '2025-11-01')?.amount, 0)
assert.equal(monthlySeries.at(-1)?.month, '2026-08-01')
assert.equal(servicePlanAverageMonthly(1200), 100)
assert.equal(servicePlanExpenseMonthOptions(2569, new Date('2026-08-27T00:00:00+07:00')).at(-1), '2026-08')

const optionalNoteExpense = servicePlanHistoricalExpenseSchema.parse({
  planId: '00000000-0000-0000-0000-000000000001',
  amount: 100,
  expenseDate: '2026-01-01',
  sourceReference: 'PR-2569-0001',
})
assert.equal(optionalNoteExpense.reason, undefined)

const underQuote = deriveServiceChecklist('annual_items', 49_999.99)
assert.equal(underQuote.attachments.filter((entry) => entry.kind === 'quotation').length, 0)
assert.equal(underQuote.committees.find((entry) => entry.kind === 'specification')?.seats, 1)

const thresholdQuote = deriveServiceChecklist('annual_items', 50_000)
assert.equal(thresholdQuote.attachments.filter((entry) => entry.kind === 'quotation').length, 0)
assert.equal(thresholdQuote.committees.find((entry) => entry.kind === 'inspection')?.seats, 1)

const thresholdCommittee = deriveServiceChecklist('annual_items', 100_000)
assert.equal(thresholdCommittee.committees.find((entry) => entry.kind === 'inspection')?.seats, 3)

const plan = servicePlanInputSchema.parse({
  fiscalYear: 2569,
  name: 'แผนตรวจประจำปี',
  department: 'งานเคมีคลินิก',
  budget: 100_000,
  type: 'laboratory_testing',
  responsibleProfileIds: [],
})
assert.equal(plan.budget, 100_000)

const labRequest = servicePurchaseRequestInputSchema.parse({
  department: 'งานเคมีคลินิก',
  requesterName: 'ผู้ขอ',
  requestedDate: '2026-01-15',
  note: null,
  planId: '00000000-0000-0000-0000-000000000001',
  amount: 50_000,
  usageStartDate: '2025-10-01',
  usageEndDate: '2026-09-30',
  items: [],
  checklist: { attachments: [], committees: [] },
  documentChoices: {},
})
assert.equal(labRequest.method, undefined)

console.log('service procurement domain: ok')
