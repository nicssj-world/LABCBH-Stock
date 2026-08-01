import assert from 'node:assert/strict'
import { CONTRACT_TYPES, contractInputSchema } from '../lib/contracts/schema'
import {
  PROCUREMENT_STAGES,
  allowedNextStages,
  requiresContractNumber,
} from '../lib/contracts/stages'
import { contractListValue } from '../lib/contracts/presenter'

assert.deepEqual(CONTRACT_TYPES, [
  'equipment_lease',
  'e_bidding',
  'annual_specific',
  'specific',
  'off_plan',
  'awaiting_equipment_lease',
  'thai_red_cross',
])

assert.deepEqual(PROCUREMENT_STAGES, [
  'sent_to_procurement',
  'plan_published',
  'tender_announced',
  'result_consideration',
  'winner_announced',
  'contract_started',
])
assert.deepEqual(allowedNextStages('sent_to_procurement'), ['plan_published'])
assert.deepEqual(allowedNextStages('contract_started'), [])
assert.equal(requiresContractNumber('winner_announced'), false)
assert.equal(requiresContractNumber('contract_started'), true)

const validDraft = {
  fiscalYear: 2569,
  contractType: 'e_bidding' as const,
  procurementStage: 'sent_to_procurement' as const,
  status: 'pending' as const,
  displayName: 'สัญญาซื้อน้ำยาตรวจวิเคราะห์',
  vendor: 'บริษัททดสอบ จำกัด',
  contractNumber: null,
  startDate: '2026-10-01',
  endDate: '2027-09-30',
  items: [
    {
      lsCode: 'LS046022',
      name: 'น้ำยาทดสอบ',
      quantity: 10,
      unit: 'กล่อง',
      unitPrice: 1250,
    },
  ],
}

assert.equal(contractInputSchema.safeParse(validDraft).success, true)
assert.equal(
  contractInputSchema.safeParse({ ...validDraft, vendor: null }).success,
  true,
  'vendor may remain unknown while procurement is in progress',
)

for (const fiscalYear of [2499, 3001, 2569.5]) {
  assert.equal(
    contractInputSchema.safeParse({ ...validDraft, fiscalYear }).success,
    false,
    `Thai fiscal year ${fiscalYear} must be rejected`,
  )
}

assert.equal(
  contractInputSchema.safeParse({
    ...validDraft,
    procurementStage: 'contract_started',
    contractNumber: null,
  }).success,
  false,
  'a started contract requires a contract number',
)

assert.equal(
  contractInputSchema.safeParse({
    ...validDraft,
    contractNumber: '  12/2569  ',
  }).success,
  false,
  'a contract number must not be assigned before contract start',
)

assert.equal(
  contractInputSchema.safeParse({
    ...validDraft,
    procurementStage: 'contract_started',
    contractNumber: '  12/2569  ',
    status: 'active',
  }).success,
  true,
)

assert.equal(
  contractInputSchema.safeParse({ ...validDraft, status: 'active' }).success,
  false,
  'an early-stage controlled contract must not be active',
)

for (const status of ['expired', 'cancelled'] as const) {
  assert.equal(
    contractInputSchema.safeParse({
      ...validDraft,
      procurementStage: 'contract_started',
      contractNumber: '12/2569',
      status,
    }).success,
    true,
    `a started contract may later become ${status}`,
  )
}

assert.equal(
  contractInputSchema.safeParse({ ...validDraft, status: 'cancelled' }).success,
  true,
  'a procurement may be cancelled before contract start',
)

assert.equal(
  contractListValue({ total: 37_492_305.3, items: [] }),
  37_492_305.3,
  'the contract register must retain the recorded contract value when legacy contracts have no item rows',
)
assert.equal(
  contractListValue({ total: null, items: validDraft.items.map((item) => ({ ...item, lineTotal: item.quantity * item.unitPrice })) }),
  12_500,
  'the contract register must fall back to the calculated item total when the recorded total is unavailable',
)
assert.equal(
  contractInputSchema.safeParse({ ...validDraft, status: 'expired' }).success,
  false,
  'a contract cannot expire before it starts',
)

assert.equal(
  contractInputSchema.safeParse({
    ...validDraft,
    procurementStage: 'contract_started',
    contractNumber: '12/2569',
    startDate: null,
    status: 'active',
  }).success,
  false,
  'a started contract requires its effective start date',
)

assert.equal(
  contractInputSchema.safeParse({
    ...validDraft,
    startDate: '2027-10-01',
    endDate: '2027-09-30',
  }).success,
  false,
  'end date must not precede start date',
)

assert.equal(
  contractInputSchema.safeParse({
    ...validDraft,
    startDate: '2026-02-31',
  }).success,
  false,
  'impossible calendar dates must be rejected instead of normalized',
)

for (const invalidItem of [
  { ...validDraft.items[0], quantity: 0 },
  { ...validDraft.items[0], quantity: -1 },
  { ...validDraft.items[0], unitPrice: 0 },
  { ...validDraft.items[0], unitPrice: -1 },
]) {
  assert.equal(
    contractInputSchema.safeParse({ ...validDraft, items: [invalidItem] }).success,
    false,
    'contract line quantities and prices must be positive',
  )
}

console.log('contracts domain: ok')
