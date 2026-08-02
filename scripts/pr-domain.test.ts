import assert from 'node:assert/strict'
import {
  PURCHASE_METHODS,
  PURCHASE_METHODS_BY_PURPOSE,
  PURCHASE_PURPOSES,
  PURCHASE_REQUEST_STATUSES,
  allowedPurchaseRequestTransitions,
  calculateLineTotal,
  contractTypeForMethod,
  formatPurchaseRequestNumber,
  methodCreatesContract,
  methodRequiresContractItems,
  purchaseMethodPurpose,
  purchaseMethodSchema,
  purchaseRequestInputSchema,
} from '../lib/pr/schema'

const contractDraft = {
  fiscalYear: 2569,
  displayName: 'สัญญาซื้อน้ำยา A',
  vendor: 'บริษัท เอ จำกัด',
  sentToStockOfficerDate: '2026-07-30',
}

// Exactly one purchase method, each with its own conditional fields.
assert.deepEqual(
  [...PURCHASE_METHODS],
  ['annual_plan', 'contract', 'awaiting_contract', 'off_plan', 'specific_contract', 'e_bidding'],
)

// Purpose is a grouping over the same six methods, not a stored value: every
// method belongs to exactly one purpose and the two lists partition the enum.
assert.deepEqual([...PURCHASE_PURPOSES], ['purchase_order', 'new_contract'])
assert.deepEqual(
  [...PURCHASE_METHODS_BY_PURPOSE.purchase_order, ...PURCHASE_METHODS_BY_PURPOSE.new_contract].sort(),
  [...PURCHASE_METHODS].sort(),
)
assert.equal(purchaseMethodPurpose('annual_plan'), 'purchase_order')
assert.equal(purchaseMethodPurpose('contract'), 'purchase_order')
assert.equal(purchaseMethodPurpose('awaiting_contract'), 'purchase_order')
assert.equal(purchaseMethodPurpose('off_plan'), 'purchase_order')
assert.equal(purchaseMethodPurpose('specific_contract'), 'new_contract')
assert.equal(purchaseMethodPurpose('e_bidding'), 'new_contract')

// specific_contract auto-fills a "specific" contract, e_bidding an "e_bidding"
// one; every purchase_order method leaves contract type undecided.
assert.equal(contractTypeForMethod('specific_contract'), 'specific')
assert.equal(contractTypeForMethod('e_bidding'), 'e_bidding')
assert.equal(contractTypeForMethod('annual_plan'), null)
assert.equal(contractTypeForMethod('contract'), null)
assert.equal(contractTypeForMethod('awaiting_contract'), null)
assert.equal(contractTypeForMethod('off_plan'), null)

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
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'awaiting_contract', contractId: 12 }).success,
  true,
  'awaiting_contract references the contract being waited on',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'awaiting_contract', reference: 'บันทึกข้อความ 12/2569' }).success,
  false,
  'awaiting_contract no longer accepts a free-text reference',
)
assert.equal(purchaseMethodSchema.safeParse({ kind: 'off_plan' }).success, true)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'specific_contract', contractDraft }).success,
  true,
  'ทำสัญญาเจาะจง drafts a new contract rather than referencing one',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'specific_contract' }).success,
  false,
  'a specific-contract PR must carry its contract draft',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'e_bidding', contractDraft }).success,
  true,
  'an E-Bidding PR drafts a new contract rather than referencing one',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'e_bidding', contractId: 12 }).success,
  false,
  'e_bidding no longer references an existing started contract',
)
assert.equal(purchaseMethodSchema.safeParse({ kind: 'unknown_method' }).success, false)

// Only an ordinary contract drawdown consumes contracted quantity; opening a
// brand-new contract (specific_contract/e_bidding) has nothing to draw down.
assert.equal(methodRequiresContractItems({ kind: 'contract', contractId: 4, purchaseSequence: 1 }), true)
assert.equal(methodRequiresContractItems({ kind: 'off_plan' }), false)
assert.equal(methodRequiresContractItems({ kind: 'e_bidding', contractDraft }), false)
assert.equal(methodRequiresContractItems({ kind: 'awaiting_contract', contractId: 4 }), false)

// methodCreatesContract flags exactly the two new_contract methods.
assert.equal(methodCreatesContract({ kind: 'specific_contract', contractDraft }), true)
assert.equal(methodCreatesContract({ kind: 'e_bidding', contractDraft }), true)
assert.equal(methodCreatesContract({ kind: 'contract', contractId: 4, purchaseSequence: 1 }), false)
assert.equal(methodCreatesContract({ kind: 'off_plan' }), false)

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
    method: { kind: 'e_bidding' as const, contractDraft },
    items: [{ ...validInput.items[0], contractItemId: null }],
  }).success,
  true,
  'opening a new contract does not draw down any existing one, so no line needs a contract item',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    method: { kind: 'e_bidding' as const, contractDraft },
  }).success,
  false,
  'a contract-opening purchase must not point a line at an existing contract item',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    method: { kind: 'e_bidding' as const, contractDraft },
    items: [{ ...validInput.items[0], contractItemId: null, unitPrice: 0 }],
  }).success,
  false,
  'a line that becomes a contract item on confirmation must carry a real unit price',
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
