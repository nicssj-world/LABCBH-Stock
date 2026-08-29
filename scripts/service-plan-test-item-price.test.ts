import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { servicePlanInputSchema, servicePurchaseRequestInputSchema } from '@/lib/service-procurement/schema'

const planWithPrice = {
  fiscalYear: 2569,
  name: 'แผนตรวจประจำปี',
  department: 'งานเคมีคลินิก',
  budget: 100_000,
  type: 'laboratory_testing' as const,
  isRedCross: true,
  requiresContract: false,
  testItems: [{ name: 'CBC', unit: 'รายการ', unitPrice: 125.5 }],
  responsibleProfileIds: [],
}

const parsedPlan = servicePlanInputSchema.parse(planWithPrice)
assert.equal(parsedPlan.testItems[0]?.unitPrice, 125.5)
assert.equal(
  servicePlanInputSchema.safeParse({ ...planWithPrice, testItems: [{ ...planWithPrice.testItems[0], unitPrice: 0 }] }).success,
  false,
  'a test item must have a positive unit price',
)
assert.equal(
  servicePlanInputSchema.safeParse({ ...planWithPrice, testItems: [{ name: 'CBC', unit: 'รายการ' }] }).success,
  false,
  'a test item must include a unit price',
)

const purchaseRequest = servicePurchaseRequestInputSchema.safeParse({
  department: 'งานเคมีคลินิก',
  requesterName: 'ผู้ขอ',
  requestedDate: '2026-01-15',
  note: null,
  planId: '00000000-0000-0000-0000-000000000001',
  amount: 50_000,
  usageStartDate: '2026-01-15',
  usageEndDate: '2026-01-16',
  items: [{ planItemId: '00000000-0000-0000-0000-000000000002', name: 'CBC', unit: 'รายการ', unitPrice: 125.5, requestedQuantity: 2 }],
  checklist: { attachments: [], committees: [] },
  documentChoices: {},
})
assert.equal(purchaseRequest.success, true, 'service PR lines must carry the plan unit price')

const migration = readFileSync('supabase/migrations/20260829132304_service_plan_test_item_unit_price.sql', 'utf8')
const queries = readFileSync('lib/service-procurement/queries.ts', 'utf8')
const purchaseForm = readFileSync('components/service-procurement/ServicePurchaseRequestForm.tsx', 'utf8')
const planDetail = readFileSync('app/(protected)/service-procurement/plans/[id]/page.tsx', 'utf8')
const requestDetail = readFileSync('app/(protected)/service-procurement/purchase-requests/[id]/page.tsx', 'utf8')

assert.match(migration, /add column if not exists unit_price numeric\(14,2\)/i)
assert.match(migration, /insert into public\.service_plan_test_items\([^)]*unit_price/i)
assert.match(migration, /item_row\.unit_price/i)
assert.match(migration, /unit_price, requested_quantity/i)
assert.match(queries, /name,unit,unit_price/)
assert.match(queries, /unitPrice: row\.unit_price === null/)
assert.match(queries, /unitPrice: entry\.unit_price === null/)
assert.match(purchaseForm, /ราคาต่อหน่วย \(บาท\)/)
assert.match(purchaseForm, /unitPrice: item\.unitPrice \?\? 0/)
assert.match(purchaseForm, /calculateServiceRequestTotal/)
assert.match(purchaseForm, /ยอดรวมรายการ/)
assert.match(purchaseForm, /<th className="numeric-cell">รวม<\/th>/)
assert.match(planDetail, /formatBaht\(item\.unitPrice\)/)
assert.match(requestDetail, /formatBaht\(item\.lineTotal\)/)

console.log('service plan test item price: ok')
