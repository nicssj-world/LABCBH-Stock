import assert from 'node:assert/strict'
import { ANNUAL_PLAN_TYPES, annualPlanInputSchema } from '../lib/annual-plans/schema'
import { annualPlanTypeLabel } from '../lib/annual-plans/presenter'

assert.deepEqual(ANNUAL_PLAN_TYPES, ['procurement', 'hiring'])
assert.deepEqual(annualPlanInputSchema.parse({ fiscalYear: 2570, planType: 'procurement' }), {
  fiscalYear: 2570,
  planType: 'procurement',
})
assert.throws(() => annualPlanInputSchema.parse({ fiscalYear: 2570.5, planType: 'procurement' }))
assert.throws(() => annualPlanInputSchema.parse({ fiscalYear: 2570, planType: 'unknown' }))
assert.equal(annualPlanTypeLabel('procurement'), 'แผนจัดซื้อ')
assert.equal(annualPlanTypeLabel('hiring'), 'แผนจัดจ้าง')

console.log('annual plans schema and labels: ok')
