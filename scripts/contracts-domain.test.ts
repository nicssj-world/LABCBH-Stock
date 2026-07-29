import assert from 'node:assert/strict'
import { CONTRACT_TYPES, contractInputSchema } from '../lib/contracts/schema'
import {
  PROCUREMENT_STAGES,
  allowedNextStages,
  requiresContractNumber,
} from '../lib/contracts/stages'

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
  }).success,
  true,
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
