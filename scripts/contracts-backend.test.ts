import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Actor } from '../lib/auth/actor'

const requiredFiles = [
  'lib/contracts/authorization.ts',
  'lib/contracts/presenter.ts',
  'lib/contracts/queries.ts',
  'lib/contracts/actions.ts',
]

for (const file of requiredFiles) {
  assert.ok(existsSync(join(process.cwd(), file)), `${file} must exist`)
}

async function main() {
  const { assertContractEditor, ContractAuthorizationError } = await import(
    '../lib/contracts/authorization'
  )
  const {
    archiveContractInputSchema,
    createContractInputSchema,
    stageAdvanceSchema,
    updateContractInputSchema,
  } = await import('../lib/contracts/schema')
  const { presentContract } = await import('../lib/contracts/presenter')

  const actor = (roles: Actor['appRoles']): Actor => ({
    id: '00000000-0000-4000-8000-000000000001',
    ephisId: '10001',
    name: 'Test User',
    profileRole: null,
    appRoles: roles,
  })

  assert.doesNotThrow(() => assertContractEditor(actor(['admin'])))
  assert.doesNotThrow(() => assertContractEditor(actor(['head'])))
  for (const roles of [['stock_officer'], ['viewer'], []] as Actor['appRoles'][]) {
    assert.throws(
      () => assertContractEditor(actor(roles)),
      (error: unknown) => error instanceof ContractAuthorizationError,
      `${roles.join(',') || 'no role'} must fail closed`,
    )
  }

  const createInput = {
    fiscalYear: 2570,
    contractType: 'e_bidding' as const,
    displayName: 'สัญญาซื้อน้ำยาตรวจวิเคราะห์',
    vendor: null,
    endDate: '2027-09-30',
    sentToProcurementDate: '2026-10-01',
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

  assert.equal(createContractInputSchema.safeParse(createInput).success, true)
  assert.equal(
    createContractInputSchema.safeParse({ ...createInput, items: [] }).success,
    false,
    'controlled contracts require at least one item',
  )
  for (const forbiddenField of ['status', 'procurementStage', 'contractNumber', 'startDate']) {
    assert.equal(
      createContractInputSchema.safeParse({ ...createInput, [forbiddenField]: 'forbidden' }).success,
      false,
      `create input must reject workflow field ${forbiddenField}`,
    )
  }

  const updateInput = {
    fiscalYear: 2570,
    contractType: 'specific' as const,
    displayName: 'สัญญาปรับปรุงชื่อ',
    vendor: 'บริษัท ทดสอบ จำกัด',
    endDate: null,
    expectedUpdatedAt: '2026-10-02T03:04:05.000Z',
    items: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        lsCode: 'LS046022',
        name: 'น้ำยาทดสอบ',
        quantity: 12,
        unit: 'กล่อง',
        unitPrice: 1250,
      },
      { ...createInput.items[0], id: null, lsCode: 'LS046023' },
    ],
  }

  assert.equal(updateContractInputSchema.safeParse(updateInput).success, true)
  for (const forbiddenField of ['status', 'procurementStage', 'contractNumber', 'startDate']) {
    assert.equal(
      updateContractInputSchema.safeParse({ ...updateInput, [forbiddenField]: 'forbidden' }).success,
      false,
      `update input must reject workflow field ${forbiddenField}`,
    )
  }

  assert.equal(archiveContractInputSchema.safeParse({ reason: '  ยกเลิกรายการซ้ำ  ' }).success, true)
  assert.equal(archiveContractInputSchema.safeParse({ reason: '   ' }).success, false)
  assert.equal(
    stageAdvanceSchema.safeParse({
      from: 'winner_announced',
      to: 'contract_started',
      effectiveDate: '2026-11-01',
      contractNumber: 'EB-2570-001',
      note: null,
    }).success,
    true,
  )
  assert.equal(
    stageAdvanceSchema.safeParse({
      from: 'winner_announced',
      to: 'contract_started',
      effectiveDate: '2026-11-01',
      contractNumber: null,
    }).success,
    false,
  )

  const presented = presentContract({
    id: 42,
    product: 'Legacy Analyzer Lease',
    fiscalYear: null,
    contractType: null,
    procurementStage: null,
    status: null,
    displayName: null,
    contractNumber: null,
    vendor: null,
    startDate: null,
    endDate: null,
    updatedAt: null,
    isArchived: null,
    // A legacy lease imported from the portal: it has a ceiling but no line
    // items and nobody assigned to it yet.
    total: 3531000,
    responsibleUserIds: [],
    fileUrl: null,
    items: [],
    stageHistory: [],
  })
  assert.equal(presented.displayName, 'Legacy Analyzer Lease')
  assert.equal(presented.fiscalYearLabel, 'ไม่ระบุปี')
  assert.equal(presented.contractTypeLabel, 'ไม่ระบุประเภท')
  assert.equal(presented.procurementStageLabel, 'ไม่ระบุขั้นตอน')
  assert.equal(presented.contractNumberLabel, 'ยังไม่มีเลขที่สัญญา')

  const queries = readFileSync(join(process.cwd(), 'lib/contracts/queries.ts'), 'utf8')
  assert.match(queries, /createClient/)
  assert.doesNotMatch(queries, /supabaseAdmin/)
  assert.match(queries, /is_archived\.eq\.false,is_archived\.is\.null/)
  assert.match(queries, /contractReadRowSchema/)

  const actions = readFileSync(join(process.cwd(), 'lib/contracts/actions.ts'), 'utf8')
  assert.match(actions, /requireActor/)
  assert.match(actions, /assertContractEditor/)
  for (const rpc of [
    'create_contract',
    'update_contract',
    'archive_contract',
    'advance_contract_stage',
  ]) {
    assert.match(actions, new RegExp(`\\.rpc\\(['"]${rpc}['"]`))
  }
  assert.doesNotMatch(actions, /\.from\(['"]contracts['"]\)\.(?:insert|update|delete)/)

  console.log('contracts backend boundaries: ok')
}

void main()
