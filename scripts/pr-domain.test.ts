import assert from 'node:assert/strict'
import { canManagePurchaseRequest } from '../lib/pr/authorization'
import type { Actor, LabStockRole } from '../lib/auth/actor'
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

const actor = (id: string, appRoles: LabStockRole[]): Actor => ({
  id,
  ephisId: null,
  name: null,
  profileRole: null,
  appRoles,
})

const owner = actor('owner-id', ['head'])
assert.equal(canManagePurchaseRequest(owner, owner.id), true, 'the PR owner can edit or cancel their own PR')
assert.equal(
  canManagePurchaseRequest(actor('other-head-id', ['head']), owner.id),
  false,
  'a different head cannot edit or cancel another requester\'s PR',
)
assert.equal(
  canManagePurchaseRequest(actor('stock-id', ['stock_officer']), owner.id),
  true,
  'a stock officer can edit or cancel any pending PR',
)
assert.equal(
  canManagePurchaseRequest(actor('admin-id', ['admin']), owner.id),
  true,
  'an admin can edit or cancel any pending PR',
)

const contractDraft = {
  fiscalYear: 2569,
  displayName: 'สัญญาซื้อน้ำยา A',
  vendor: 'บริษัท เอ จำกัด',
  sentToStockOfficerDate: '2026-07-30',
}

// Exactly one purchase method, each with its own conditional fields.
assert.deepEqual(
  [...PURCHASE_METHODS],
  ['annual_plan', 'contract', 'awaiting_contract', 'off_plan', 'specific_contract', 'e_bidding', 'equipment_lease'],
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
assert.equal(purchaseMethodPurpose('equipment_lease'), 'new_contract')

// specific_contract auto-fills a "specific" contract, e_bidding an "e_bidding"
// one, equipment_lease an "equipment_lease" one; every purchase_order method
// leaves contract type undecided. A lease never places a purchase order (it
// draws cost down monthly instead), so it has no purchase_order counterpart.
assert.equal(contractTypeForMethod('specific_contract'), 'specific')
assert.equal(contractTypeForMethod('e_bidding'), 'e_bidding')
assert.equal(contractTypeForMethod('equipment_lease'), 'equipment_lease')
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
  // vendor is `.nullable()` on every variant (an explicit null always passes);
  // the UI never sends that literal null, only a blank string, so that's what
  // actually exercises "required" here.
  purchaseMethodSchema.safeParse({ kind: 'specific_contract', contractDraft: { ...contractDraft, vendor: '' } }).success,
  false,
  'ทำสัญญาเจาะจง already knows its vendor, so a blank one must be rejected',
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
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'e_bidding', contractDraft: { ...contractDraft, vendor: '' } }).success,
  true,
  'E-Bidding is requested before bidding runs, so a blank vendor must be accepted',
)
assert.equal(purchaseMethodSchema.safeParse({ kind: 'unknown_method' }).success, false)

// เช่าเครื่อง drafts a lease contract, carrying a required ceiling the other
// two origination methods must never accept.
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'equipment_lease', contractDraft: { ...contractDraft, total: 1_200_000 } }).success,
  true,
  'a lease PR carries a ceiling on its contract draft',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'equipment_lease', contractDraft: { ...contractDraft, total: null } }).success,
  false,
  'unlike the direct "เพิ่มสัญญา" form, a lease requested via PR must state its ceiling',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'equipment_lease', contractDraft }).success,
  false,
  'a lease draft must carry a total field',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'equipment_lease', contractDraft: { ...contractDraft, total: 0 } }).success,
  false,
  'a zero ceiling is rejected the same way create_contract would reject a non-positive total',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'specific_contract', contractDraft: { ...contractDraft, total: 1_200_000 } }).success,
  false,
  'only a lease draft may carry a ceiling',
)
assert.equal(
  purchaseMethodSchema.safeParse({ kind: 'equipment_lease', contractDraft: { ...contractDraft, vendor: '', total: 1_200_000 } }).success,
  true,
  'the lessor may not be chosen yet when the lease is first requested, so a blank vendor must be accepted',
)

// Only an ordinary contract drawdown consumes contracted quantity; opening a
// brand-new contract (specific_contract/e_bidding) has nothing to draw down.
assert.equal(methodRequiresContractItems({ kind: 'contract', contractId: 4, purchaseSequence: 1 }), true)
assert.equal(methodRequiresContractItems({ kind: 'off_plan' }), false)
assert.equal(methodRequiresContractItems({ kind: 'e_bidding', contractDraft }), false)
assert.equal(methodRequiresContractItems({ kind: 'awaiting_contract', contractId: 4 }), false)

// methodCreatesContract flags exactly the three new_contract methods.
assert.equal(methodCreatesContract({ kind: 'specific_contract', contractDraft }), true)
assert.equal(methodCreatesContract({ kind: 'e_bidding', contractDraft }), true)
assert.equal(methodCreatesContract({ kind: 'equipment_lease', contractDraft: { ...contractDraft, total: 1_200_000 } }), true)
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

// A lease has no reagent lines: zero items is required, not just allowed.
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    method: { kind: 'equipment_lease' as const, contractDraft: { ...contractDraft, total: 1_200_000 } },
    items: [],
  }).success,
  true,
  'a lease PR originates a contract with zero items',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...validInput,
    method: { kind: 'equipment_lease' as const, contractDraft: { ...contractDraft, total: 1_200_000 } },
  }).success,
  false,
  'a lease PR must not carry any reagent lines',
)

console.log('purchase request domain: ok')
