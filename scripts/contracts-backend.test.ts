import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Actor } from '../lib/auth/actor'

const requiredFiles = [
  'lib/contracts/authorization.ts',
  'lib/contracts/presenter.ts',
  'lib/contracts/queries.ts',
  'lib/contracts/actions.ts',
  'lib/contracts/budget-actions.ts',
]

for (const file of requiredFiles) {
  assert.ok(existsSync(join(process.cwd(), file)), `${file} must exist`)
}

async function main() {
  const {
    assertContractEditor,
    assertContractStageHistoryEditor,
    ContractAuthorizationError,
  } = await import(
    '../lib/contracts/authorization'
  )
  const {
    archiveContractInputSchema,
    createContractInputSchema,
    expireContractInputSchema,
    stageHistoryCorrectionInputSchema,
    stageAdvanceSchema,
    updateContractInputSchema,
  } = await import('../lib/contracts/schema')
  const { effectiveContractStatus, presentContract } = await import('../lib/contracts/presenter')

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

  assert.doesNotThrow(() => assertContractStageHistoryEditor(actor(['admin'])))
  assert.doesNotThrow(() => assertContractStageHistoryEditor(actor(['stock_officer'])))
  for (const roles of [['head'], ['viewer'], []] as Actor['appRoles'][]) {
    assert.throws(
      () => assertContractStageHistoryEditor(actor(roles)),
      (error: unknown) => error instanceof ContractAuthorizationError,
      `${roles.join(',') || 'no role'} must not edit stage history`,
    )
  }

  const createInput = {
    fiscalYear: 2570,
    contractType: 'e_bidding' as const,
    department: 'งานเคมีคลินิก' as const,
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
  for (const forbiddenField of ['status', 'procurementStage', 'startDate']) {
    assert.equal(
      createContractInputSchema.safeParse({ ...createInput, [forbiddenField]: 'forbidden' }).success,
      false,
      `create input must reject workflow field ${forbiddenField}`,
    )
  }

  // contractNumber is the one deliberate exception: the admin-only
  // "already started" fast path supplies it at creation time instead of
  // reaching contract_started through advance_contract_stage.
  assert.equal(
    createContractInputSchema.safeParse({ ...createInput, contractNumber: null }).success,
    true,
    'omitting contractNumber keeps the normal creation path',
  )
  assert.equal(
    createContractInputSchema.safeParse({ ...createInput, contractNumber: 'CN-2569-001' }).success,
    true,
    'a non-blank contractNumber is accepted for the start-immediately fast path',
  )
  assert.equal(
    createContractInputSchema.safeParse({ ...createInput, contractNumber: '   ' }).success,
    false,
    'a blank contractNumber must still be rejected',
  )

  const updateInput = {
    fiscalYear: 2570,
    contractType: 'specific' as const,
    department: 'งานเคมีคลินิก' as const,
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
  assert.equal(expireContractInputSchema.safeParse({ reason: 'ครบกำหนดตามสัญญา' }).success, true)
  assert.equal(expireContractInputSchema.safeParse({ reason: '   ' }).success, false)
  assert.equal(
    effectiveContractStatus('active', '2026-08-01', new Date('2026-08-02T12:00:00Z')),
    'expired',
    'an active contract must be shown as expired from the day after its end date',
  )
  assert.equal(
    effectiveContractStatus('active', '2026-08-02', new Date('2026-08-02T12:00:00Z')),
    'active',
    'the contract end date must remain inclusive',
  )
  assert.equal(
    effectiveContractStatus('cancelled', '2026-08-01', new Date('2026-08-02T12:00:00Z')),
    'cancelled',
    'automatic expiry must not overwrite an explicit cancellation',
  )
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
  assert.equal(
    stageHistoryCorrectionInputSchema.safeParse({
      historyId: '10000000-0000-4000-8000-000000000001',
      effectiveDate: '2026-10-01',
      reason: 'แก้ไขวันที่ที่บันทึกผิด',
    }).success,
    true,
  )

  const presented = presentContract({
    id: 42,
    product: 'Legacy Analyzer Lease',
    fiscalYear: null,
    contractType: null,
    department: null,
    procurementStage: null,
    status: null,
    displayName: null,
    contractNumber: null,
    vendor: null,
    startDate: null,
    endDate: null,
    updatedAt: null,
    isArchived: null,
    archivedAt: null,
    archiveReason: null,
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
  assert.doesNotMatch(
    queries,
    /contract_stage_history\s*\([\s\S]*?contract_stage_history_corrections\s*\(/,
    'base contract reads must not depend on an unapplied optional correction relation',
  )

  const actions = readFileSync(join(process.cwd(), 'lib/contracts/actions.ts'), 'utf8')
  assert.match(actions, /requireActor/)
  assert.match(actions, /assertContractEditor/)
  assert.match(actions, /import \{ omitNullishProperties \} from ['"]@\/lib\/validation\/json['"]/, 'contract actions must use the shared JSON payload normalizer')
  assert.match(actions, /const rpcItems = items\.map\(omitNullishProperties\)/, 'contract creation must normalize nullable item fields before the RPC call')
  assert.match(actions, /p_items: rpcItems/, 'contract creation must send the normalized item payload')
  assert.match(actions, /if \(!isAdministrator\(actor\)\)[\s\S]*ไม่มีสิทธิ์เก็บรายการสัญญา/, 'archive writes must reject non-admin callers')
  assert.match(actions, /expireContract[\s\S]*if \(!isAdministrator\(actor\)\)[\s\S]*ไม่มีสิทธิ์เปลี่ยนสถานะสิ้นสุดสัญญา/, 'manual expiry writes must reject non-admin callers')
  for (const rpc of [
    'create_contract',
    'update_contract',
    'archive_contract',
    'expire_contract',
    'advance_contract_stage',
    'correct_contract_stage_history',
    'backfill_contract_stage_history',
  ]) {
    assert.match(actions, new RegExp(`\\.rpc\\(['"]${rpc}['"]`))
  }
  assert.doesNotMatch(actions, /\.from\(['"]contracts['"]\)\.(?:insert|update|delete)/)

  const budgetActions = readFileSync(join(process.cwd(), 'lib/contracts/budget-actions.ts'), 'utf8')
  assert.match(budgetActions, /isAdministrator/, 'responsible-user writes must verify the admin role server-side')
  assert.match(
    budgetActions,
    /if \(!isAdministrator\(actor\)\)[\s\S]*ไม่มีสิทธิ์กำหนดผู้รับผิดชอบสัญญา/,
    'non-admins must fail closed even if they call the Server Action directly',
  )

  const expiryMigration = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260801173118_expire_contract_status.sql'),
    'utf8',
  )
  assert.match(expiryMigration, /create or replace function public\.expire_contract/, 'manual expiry must be an atomic database transition')
  assert.match(expiryMigration, /if target_contract\.status <> 'active'/, 'new expense writes must reject an expired contract under the row lock')

  const expiryFixMigration = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260811100000_fix_expire_contract_updated_by.sql'),
    'utf8',
  )
  assert.match(expiryFixMigration, /create or replace function public\.expire_contract/, 'expiry fix must replace the broken RPC')
  assert.doesNotMatch(
    expiryFixMigration,
    /updated_by\s*=|updated_by\s*,/,
    'manual expiry must not write the nonexistent contracts.updated_by column',
  )

  console.log('contracts backend boundaries: ok')
}

void main()
