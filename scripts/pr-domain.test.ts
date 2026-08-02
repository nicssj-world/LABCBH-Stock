import assert from 'node:assert/strict'
import {
  PURCHASE_METHODS,
  PURCHASE_REQUEST_STATUSES,
  allowedPurchaseRequestTransitions,
  calculateLineTotal,
  formatPurchaseRequestNumber,
  methodRequiresContractItems,
  purchaseMethodSchema,
  purchaseRequestInputSchema,
} from '../lib/pr/schema'

// Exactly one purchase method, each with its own conditional fields.
assert.deepEqual(
  [...PURCHASE_METHODS],
  ['annual_plan', 'contract', 'awaiting_contract', 'off_plan', 'specific_contract', 'e_bidding'],
)

assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'annual_plan', fiscalYear: 2569, planSequence: '12' }).success,
  true,
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'annual_plan', fiscalYear: 2569 }).success,
  false,
  'the annual plan needs its plan sequence',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'contract', contractId: 12, purchaseSequence: 3 }).success,
  true,
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'contract', contractId: 12, purchaseSequence: 0 }).success,
  false,
  'purchase sequence counts from one',
)
assert.equal(purchaseMethodSchema.safeParse({ kind: 'off_plan' }).success, true)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'e_bidding', contractId: 12 }).success,
  true,
  'an E-Bidding PR references its E-Bidding contract',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'e_bidding' }).success,
  false,
  'an E-Bidding PR must choose a contract',
)
assert.equal(purchaseMethodSchema.safeParse({ kind: 'unknown_method' }).success, false)

// Contract and E-Bidding purchases consume contracted quantity.
assert.equal(methodRequiresContractItems({ kind: 'contract', contractId: 4, purchaseSequence: 1 }), true)
assert.equal(methodRequiresContractItems({ kind: 'off_plan' }), false)
assert.equal(methodRequiresContractItems({ kind: 'e_bidding', contractId: 4 }), true)

// Status flow: a PR is drafted, submitted, confirmed, and only then reversed.
assert.deepEqual(
  [...PURCHASE_REQUEST_STATUSES],
  ['draft', 'pending', 'completed', 'cancelled', 'reversed'],
)
assert.deepEqual(allowedPurchaseRequestTransitions('draft'), ['pending', 'cancelled'])
assert.deepEqual(allowedPurchaseRequestTransitions('pending'), ['completed', 'cancelled'])
assert.deepEqual(allowedPurchaseRequestTransitions('completed'), ['reversed'])
assert.deepEqual(allowedPurchaseRequestTransitions('cancelled'), [])
assert.deepEqual(allowedPurchaseRequestTransitions('reversed'), [])

// Line totals round to satang, matching numeric(17,2) in the ledger.
assert.equal(calculateLineTotal(3, 12.5), 37.5)
assert.equal(calculateLineTotal(3, 0.335), 1.01, 'line totals round half up to two decimals')
assert.equal(calculateLineTotal(0.001, 1), 0)

assert.equal(formatPurchaseRequestNumber(2569, 7), 'PR-2569-0007')
assert.equal(formatPurchaseRequestNumber(2569, 1234), 'PR-2569-1234')

const validInput = {
  department: 'กลุ่มงานเทคนิคการแพทย์',
  headName: 'หัวหน้างาน',
  requestedDate: '2026-07-30',
  note: null,
  method: { kind: 'contract' as const, contractId: 12, purchaseSequence: 2 },
  items: [
    {
      inventoryItemId: '11111111-1111-4111-8111-111111111111',
      contractItemId: '22222222-2222-4222-8222-222222222222',
      requestedQuantity: 10,
      unit: 'กล่อง',
      unitPrice: 250,
    },
  ],
}

assert.equal(purchaseRequestInputSchema.safeParse(validInput).success, true)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    method: { kind: 'e_bidding' as const, contractId: 12 },
  }).success,
  true,
  'an E-Bidding purchase must retain each chosen contract item for automatic deduction',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    method: { kind: 'e_bidding' as const, contractId: 12 },
    items: [{ ...validInput.items[0], contractItemId: null }],
  }).success,
  false,
  'an E-Bidding purchase must point every line at an item in its contract',
)
const missingHeadName = purchaseRequestInputSchema.safeParse({ ...validInput, headName: '' })
assert.equal(missingHeadName.success, false)
if (!missingHeadName.success) {
  assert.ok(
    missingHeadName.error.issues.some((issue) => issue.message === 'กรุณาระบุหัวหน้างาน'),
    'the supervisor validation message uses the current label',
  )
}
assert.equal(
  purchaseRequestInputSchema.safeParse({ ...validInput, items: [] }).success,
  false,
  'a PR must request at least one line',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    items: [{ ...validInput.items[0], requestedQuantity: 0 }],
  }).success,
  false,
  'zero-quantity lines are rejected',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    items: [{ ...validInput.items[0], contractItemId: null }],
  }).success,
  false,
  'a contract purchase must point every line at a contract item',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    method: { kind: 'off_plan' as const },
    items: [{ ...validInput.items[0], contractItemId: null }],
  }).success,
  true,
  'an off-plan purchase needs no contract item',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    method: { kind: 'off_plan' as const },
  }).success,
  false,
  'a non-contract purchase must not consume contracted quantity',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    items: [validInput.items[0], validInput.items[0]],
  }).success,
  false,
  'the same contract item cannot appear twice in one PR',
)

console.log('purchase request domain: ok')
