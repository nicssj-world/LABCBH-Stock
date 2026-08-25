import assert from 'node:assert/strict'
import {
  deriveServiceChecklist,
  servicePurchaseRequestInputSchema,
  servicePlanInputSchema,
} from '@/lib/service-procurement/schema'
import {
  calculateAnnualRequestTotal,
  deriveServiceFulfillment,
  fiscalYearFromDate,
  fiscalYearRange,
  formatServiceRequestNumber,
  planBalance,
} from '@/lib/service-procurement/domain'

assert.equal(fiscalYearFromDate('2025-09-30'), 2568)
assert.equal(fiscalYearFromDate('2025-10-01'), 2569)
assert.deepEqual(fiscalYearRange(2569), { start: '2025-10-01', end: '2026-09-30' })
assert.equal(formatServiceRequestNumber(2569, 7), 'SPR-2569-0007')

assert.equal(calculateAnnualRequestTotal([
  { requestedQuantity: 2, unitPrice: 125.5 },
  { requestedQuantity: 3, unitPrice: 10 },
]), 281)

assert.deepEqual(planBalance({ budget: 1000, spent: 250, reserved: 300 }), {
  budget: 1000,
  spent: 250,
  reserved: 300,
  available: 450,
})

assert.equal(deriveServiceFulfillment(10, 0), 'not_started')
assert.equal(deriveServiceFulfillment(10, 5), 'partial')
assert.equal(deriveServiceFulfillment(10, 10), 'complete')

const underQuote = deriveServiceChecklist('annual_items', 49_999.99)
assert.equal(underQuote.attachments.filter((entry) => entry.kind === 'quotation').length, 1)
assert.equal(underQuote.committees.find((entry) => entry.kind === 'specification')?.seats, 1)

const thresholdQuote = deriveServiceChecklist('annual_items', 50_000)
assert.equal(thresholdQuote.attachments.filter((entry) => entry.kind === 'quotation').length, 3)
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
  planId: null,
  method: 'laboratory_testing',
  amount: 50_000,
  requestedPoMonth: '2026-01',
  items: [],
  checklist: { attachments: [], committees: [] },
})
assert.equal(labRequest.method, 'laboratory_testing')

console.log('service procurement domain: ok')
