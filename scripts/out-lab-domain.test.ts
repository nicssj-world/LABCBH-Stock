import assert from 'node:assert/strict'
import { budgetSnapshot } from '../lib/contracts/budget'
import {
  outLabCreateInputSchema,
  outLabStageAdvanceSchema,
  outLabUpdateInputSchema,
  outLabUsageInputSchema,
} from '../lib/out-lab/schema'
import { canRecordOutLabUsage } from '../lib/out-lab/authorization'
import { outLabBudgetNotice, presentOutLabContract } from '../lib/out-lab/presenter'
import { outLabUsageCsv, outLabUsageSheetXml } from '../lib/out-lab/export'
import { isOutLabFilePathAllowed, outLabFilePath } from '../lib/out-lab/files'
import type { OutLabContractRecord } from '../lib/out-lab/types'
import type { Actor, LabStockRole } from '../lib/auth/actor'

const CONTRACT_ID = '11111111-1111-4111-8111-111111111111'

const ceilingBase = {
  kind: 'contract_ceiling' as const,
  entryCadence: 'monthly' as const,
  fiscalYear: 2569,
  displayName: 'จ้างบริการตรวจวิเคราะห์ทางห้องปฏิบัติการตรวจต่อพิเศษ',
  vendor: 'N-Health',
  department: 'งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ' as const,
  total: 10_000_000,
  startDate: '2025-11-01',
  endDate: '2026-10-31',
  effectiveDate: '2025-10-01',
}

const planBase = {
  kind: 'annual_plan' as const,
  entryCadence: 'quarterly' as const,
  fiscalYear: 2569,
  displayName: 'จ้างบริการตรวจวิเคราะห์ฯ เพื่อตรวจการติดเชื้อเอชไอวี-1',
  vendor: 'กรมวิทยาศาสตร์การแพทย์',
  department: 'งานภูมิคุ้มกันวิทยาคลินิก' as const,
  total: 60_000,
}

assert.doesNotThrow(() => outLabCreateInputSchema.parse(ceilingBase))
assert.doesNotThrow(() => outLabCreateInputSchema.parse(planBase))

// An annual plan's period is its fiscal year and is derived by the RPC.
// Accepting dates here would let the two disagree, silently.
assert.throws(
  () => outLabCreateInputSchema.parse({ ...planBase, startDate: '2025-10-01' }),
  /ไม่ต้องระบุวันที่/,
)

// A ceiling row is measured over its own period, so it cannot go without one.
assert.throws(() => outLabCreateInputSchema.parse({ ...ceilingBase, endDate: null }), /วันสิ้นสุดสัญญา/)
assert.throws(
  () => outLabCreateInputSchema.parse({ ...ceilingBase, endDate: '2025-10-31' }),
  /วันสิ้นสุดสัญญาต้องไม่มาก่อนวันเริ่มสัญญา/,
)

// An annual plan has no procurement to walk, so it can have no contract number
// and needs no first-stage date.
assert.throws(
  () => outLabCreateInputSchema.parse({ ...planBase, contractNumber: '8/68' }),
  /ไม่มีขั้นตอนจัดซื้อ/,
)
assert.throws(
  () => outLabCreateInputSchema.parse({ ...ceilingBase, effectiveDate: null }),
  /วันที่มีผลของขั้นตอนแรก/,
)

// .strict() everywhere: a field the RPC would reject must fail in the form,
// where the message can name it.
assert.throws(() => outLabCreateInputSchema.parse({ ...planBase, items: [] }))
assert.throws(() =>
  outLabUpdateInputSchema.parse({ ...planBase, expectedUpdatedAt: null, procurementStage: 'plan_published' }),
)

// A null ceiling means "not stated"; zero and negatives are not ceilings.
assert.doesNotThrow(() => outLabCreateInputSchema.parse({ ...planBase, total: null }))
assert.throws(() => outLabCreateInputSchema.parse({ ...planBase, total: 0 }), /มากกว่า 0/)

assert.doesNotThrow(() =>
  outLabUsageInputSchema.parse({ contractId: CONTRACT_ID, amount: 12_720, usageMonth: '2025-10-01' }),
)
assert.throws(
  () => outLabUsageInputSchema.parse({ contractId: CONTRACT_ID, amount: 0, usageMonth: '2025-10-01' }),
  /จำนวนเงินต้องมากกว่า 0/,
)
assert.throws(() =>
  outLabUsageInputSchema.parse({
    contractId: CONTRACT_ID,
    amount: 100,
    usageMonth: '2025-10-01',
    note: 'x'.repeat(501),
  }),
)
// The id is a uuid here, not the bigint the contract register uses. Passing one
// register's id to the other must fail before it reaches the database.
assert.throws(() => outLabUsageInputSchema.parse({ contractId: 42, amount: 100, usageMonth: '2025-10-01' }))

// Stages advance one at a time, and the contract number appears exactly once.
assert.throws(
  () =>
    outLabStageAdvanceSchema.parse({
      from: 'sent_to_procurement',
      to: 'winner_announced',
      effectiveDate: '2026-01-05',
    }),
  /ตามลำดับ/,
)
assert.throws(
  () =>
    outLabStageAdvanceSchema.parse({
      from: 'winner_announced',
      to: 'contract_started',
      effectiveDate: '2026-01-05',
    }),
  /ต้องระบุเลขที่สัญญา/,
)

function actor(roles: LabStockRole[], id = 'actor-1'): Actor {
  return { id, ephisId: null, name: null, department: null, profileRole: null, appRoles: roles }
}

// The people entering these figures day to day are Medical Technologists who
// hold no editor role and reach the form only by being named on the contract.
assert.equal(canRecordOutLabUsage(actor(['head']), { responsibleUserIds: [] }), true)
assert.equal(canRecordOutLabUsage(actor(['viewer']), { responsibleUserIds: [] }), false)
assert.equal(canRecordOutLabUsage(actor(['viewer']), { responsibleUserIds: ['actor-1'] }), true)

// A plan may be spent past; a contract cannot, so "over" reads differently.
const overspent = budgetSnapshot({ total: 60_000, entries: [{ amount: 61_000 }] })
assert.equal(outLabBudgetNotice('annual_plan', overspent)?.tone, 'over')
assert.match(outLabBudgetNotice('annual_plan', overspent)!.label, /เกินงบตามแผน/)
assert.match(outLabBudgetNotice('contract_ceiling', overspent)!.label, /เกินมูลค่าสัญญา/)

assert.equal(outLabBudgetNotice('annual_plan', budgetSnapshot({ total: 100, entries: [{ amount: 10 }] }))?.tone, 'ok')
assert.equal(outLabBudgetNotice('annual_plan', budgetSnapshot({ total: 100, entries: [{ amount: 80 }] }))?.tone, 'low')

// An unknown ceiling is not an exhausted one, so there is nothing to report.
assert.equal(outLabBudgetNotice('annual_plan', budgetSnapshot({ total: null, entries: [{ amount: 80 }] })), null)

const record: OutLabContractRecord = {
  id: CONTRACT_ID,
  kind: 'annual_plan',
  entryCadence: 'quarterly',
  fiscalYear: 2569,
  displayName: 'HIV กรมวิทย์',
  vendor: null,
  department: null,
  contractNumber: null,
  total: 60_000,
  startDate: '2025-10-01',
  endDate: '2026-09-30',
  procurementStage: null,
  status: 'active',
  isArchived: false,
  archiveReason: null,
  responsibleUserIds: [],
  fileUrl: null,
  note: null,
  createdAt: '2025-10-01T00:00:00Z',
  updatedAt: '2025-10-01T00:00:00Z',
  stageHistory: [],
}

// The end date is inclusive: a plan is still active on its final day and only
// reads as ended the following Bangkok day.
assert.equal(presentOutLabContract(record, new Date('2026-09-30T12:00:00+07:00')).effectiveStatus, 'active')
assert.equal(presentOutLabContract(record, new Date('2026-10-01T12:00:00+07:00')).effectiveStatus, 'expired')
assert.equal(presentOutLabContract(record).procurementStageLabel, null, 'an annual plan has no stage to label')
assert.equal(presentOutLabContract(record).contractNumberLabel, 'ยังไม่มีเลขที่สัญญา')

const usageRows = [
  {
    id: 'a',
    usageMonth: '2025-10-01',
    amount: 12_720,
    note: 'ส่ง, กรมวิทย์',
    recordedBy: 'ผู้ใช้ทดสอบ',
    createdAt: '2025-11-01T00:00:00Z',
    updatedAt: '2025-11-01T00:00:00Z',
  },
]

const csv = outLabUsageCsv(usageRows)
// Excel reads the system codepage unless the file opens with a BOM, which turns
// every Thai character into mojibake.
assert.ok(csv.startsWith('﻿'), 'CSV must open with a BOM')
assert.match(csv, /เดือน,ปีงบประมาณ,จำนวนเงิน,ผู้บันทึก,หมายเหตุ/)
// October already belongs to the next fiscal year, which is the whole reason
// the column exists.
assert.match(csv, /2025-10,2569,12720\.00/)
assert.match(csv, /"ส่ง, กรมวิทย์"/, 'a comma inside a value must be quoted, not split')

const sheet = outLabUsageSheetXml({ contractNumber: null, displayName: 'HIV' }, usageRows)
assert.match(sheet, /<Data ss:Type="Number">12720\.00<\/Data>/)

const path = outLabFilePath(CONTRACT_ID, 'สัญญา 8/68.pdf')
assert.ok(path.startsWith(`out-lab/${CONTRACT_ID}/`))
assert.equal(isOutLabFilePathAllowed(path, CONTRACT_ID), true)
// The prefix is what decides whose folder is read, so traversal and
// cross-contract paths are rejected rather than trusted from the caller.
assert.equal(isOutLabFilePathAllowed(`out-lab/${CONTRACT_ID}/../other/x.pdf`, CONTRACT_ID), false)
assert.equal(isOutLabFilePathAllowed('contracts/12/x.pdf', CONTRACT_ID), false)

console.log('out lab domain tests passed')
