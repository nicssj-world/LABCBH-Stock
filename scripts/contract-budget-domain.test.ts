import assert from 'node:assert/strict'
import {
  budgetSnapshot,
  contractMode,
  contractRemainingPercent,
  expenseMonthlySeries,
  expenseMonthOptions,
  isExpiring,
  isLowBudget,
  monthsLeft,
  normalizeUsageMonth,
} from '../lib/contracts/budget'
import { contractExpenseInputSchema, createContractInputSchema } from '../lib/contracts/schema'
import {
  assertContractExpenseRecorder,
  canRecordContractExpense,
} from '../lib/contracts/authorization'
import type { Actor, LabStockRole } from '../lib/auth/actor'
import { expenseCsv, expenseSheetXml } from '../lib/contracts/export'

// Only equipment leases are tracked in baht. Everything else keeps line items.
assert.equal(contractMode('equipment_lease'), 'budget')
assert.equal(contractMode('e_bidding'), 'supply')
assert.equal(contractMode('awaiting_equipment_lease'), 'supply')

// A month is stored as its first day so two entries for the same month collide.
assert.equal(normalizeUsageMonth('2026-07'), '2026-07-01')
assert.equal(normalizeUsageMonth('2026-07-19'), '2026-07-01')
assert.equal(normalizeUsageMonth('2026-13'), null, 'month 13 is not a month')
assert.equal(normalizeUsageMonth('2026-00'), null)
assert.equal(normalizeUsageMonth('rubbish'), null)

// Remaining is rounded to satang before comparison so float drift cannot make
// an exactly-exhausted budget look like it has a fraction left.
const snap = budgetSnapshot({ total: 1000, entries: [{ amount: 333.33 }, { amount: 666.67 }] })
assert.equal(snap.used, 1000)
assert.equal(snap.remaining, 0)
assert.equal(snap.exhausted, true)
assert.equal(snap.percentUsed, 100)

// A contract with no total has an unknown budget, not a zero one.
const unknown = budgetSnapshot({ total: null, entries: [{ amount: 500 }] })
assert.equal(unknown.remaining, null)
assert.equal(unknown.percentUsed, null)
assert.equal(unknown.used, 500)

const now = new Date('2026-07-30T00:00:00Z')
// Large contracts get a longer runway because replacing them takes longer.
assert.equal(isExpiring(20_000_000, '2026-12-01', now), true, 'big contract, 4 months out')
assert.equal(isExpiring(5_000_000, '2026-12-01', now), false, 'small contract, 4 months out')
assert.equal(isExpiring(5_000_000, '2026-09-15', now), true, 'small contract, under 3 months')
assert.equal(isExpiring(5_000_000, null, now), false, 'no end date never expires')
assert.equal(monthsLeft(null, now), 999)

assert.equal(isLowBudget(1000, 701), true, 'under 30% remaining')
assert.equal(isLowBudget(1000, 700), false, 'exactly 30% is not low')
assert.equal(isLowBudget(null, 700), false, 'unknown total is not low')
assert.equal(isLowBudget(0, 0), false, 'zero total cannot be a ratio')

// The register uses one remaining-balance metric for both contract modes:
// leases draw down baht, while supply contracts draw down allocated quantities.
assert.equal(
  contractRemainingPercent({
    contractType: 'equipment_lease',
    total: 1000,
    usage: [{ amount: 250 }, { amount: 250 }],
    items: [],
  }),
  50,
)
assert.equal(
  contractRemainingPercent({
    contractType: 'e_bidding',
    total: null,
    usage: [],
    items: [{ quantity: 10, unitPrice: 100, allocations: [{ quantity: 2 }] }],
  }),
  80,
)
assert.equal(
  contractRemainingPercent({
    contractType: 'e_bidding',
    total: null,
    usage: [],
    items: [
      { quantity: 1, unitPrice: 100, allocations: [] },
      { quantity: 10, unitPrice: 10, allocations: [{ quantity: 10 }] },
    ],
  }),
  50,
  'the collapsed gauge must weight every item by its contract line value',
)
assert.equal(
  contractRemainingPercent({ contractType: 'equipment_lease', total: null, usage: [], items: [] }),
  null,
  'a lease without a ceiling cannot report a percentage',
)
assert.equal(
  contractRemainingPercent({
    contractType: 'equipment_lease',
    total: 1000,
    usage: [{ amount: 1200 }],
    items: [],
  }),
  0,
  'an exhausted lease must not render a negative gauge',
)

// Options are bounded by the contract term so nobody bills a month it did not cover.
assert.deepEqual(
  expenseMonthOptions('2026-05-10', '2026-08-20'),
  ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'],
)
assert.deepEqual(expenseMonthOptions(null, '2026-08-20'), [])

// The monthly chart must show every month since the contract started, not only
// the months someone happened to record an expense. Multiple records for one
// month are intentionally aggregated into one bar.
assert.deepEqual(
  expenseMonthlySeries(
    '2026-05-10',
    '2026-12-31',
    [
      { usageMonth: '2026-05-01', amount: 100 },
      { usageMonth: '2026-07-01', amount: 300 },
      { usageMonth: '2026-07-01', amount: 25 },
    ],
    new Date('2026-08-15T00:00:00Z'),
  ),
  [
    { month: '2026-05-01', amount: 100 },
    { month: '2026-06-01', amount: 0 },
    { month: '2026-07-01', amount: 325 },
    { month: '2026-08-01', amount: 0 },
  ],
)

// ── contract input schema ───────────────────────────────────────────────────
const leaseBase = {
  fiscalYear: 2569,
  contractType: 'equipment_lease' as const,
  department: 'งานเคมีคลินิก' as const,
  displayName: 'เช่าเครื่อง CBC',
  vendor: 'Firmer',
  endDate: '2027-06-30',
  sentToProcurementDate: '2026-07-01',
}

// A lease has no line items, and demanding one made it impossible to create.
assert.doesNotThrow(() => createContractInputSchema.parse({ ...leaseBase, items: [] }))
assert.throws(
  () => createContractInputSchema.parse({ ...leaseBase, contractType: 'e_bidding', items: [] }),
  /ต้องมีรายการน้ำยาอย่างน้อย 1 รายการ/,
  'a supply contract still requires items',
)
assert.throws(
  () =>
    createContractInputSchema.parse({
      ...leaseBase,
      items: [{ lsCode: 'LS1', name: 'x', quantity: 1, unit: 'ea', unitPrice: 10 }],
    }),
  /สัญญาเช่าเครื่องไม่มีรายการน้ำยา/,
  'a lease must not smuggle in line items',
)

assert.throws(
  () => contractExpenseInputSchema.parse({ contractId: 1, amount: 0, usageMonth: '2026-07-01' }),
  /จำนวนเงินต้องมากกว่า 0/,
)
assert.doesNotThrow(() =>
  contractExpenseInputSchema.parse({ contractId: 1, amount: 1500.5, usageMonth: '2026-07-01' }),
)

// ── who may record an expense ───────────────────────────────────────────────
// Mirrors assert_contract_expense_actor. The responsible-user path is the one
// the workflow actually depends on: every person currently named on a contract
// is a Medical Technologist holding no editor role.
const actor = (id: string, roles: LabStockRole[]): Actor => ({
  id,
  ephisId: null,
  name: null,
  profileRole: null,
  appRoles: roles,
})

const head = actor('11111111-1111-1111-1111-111111111111', ['head'])
const mt = actor('22222222-2222-2222-2222-222222222222', [])
const stranger = actor('33333333-3333-3333-3333-333333333333', [])

assert.equal(canRecordContractExpense(head, { responsibleUserIds: [] }), true, 'editors always may')
assert.equal(
  canRecordContractExpense(mt, { responsibleUserIds: [mt.id] }),
  true,
  'a named non-editor may record on that contract',
)
assert.equal(
  canRecordContractExpense(mt, { responsibleUserIds: [stranger.id] }),
  false,
  'being named on another contract grants nothing here',
)
assert.equal(canRecordContractExpense(stranger, { responsibleUserIds: [] }), false)

assert.throws(
  () => assertContractExpenseRecorder(stranger, { responsibleUserIds: [] }),
  /ไม่มีสิทธิ์บันทึกค่าใช้จ่ายของสัญญานี้/,
)
assert.doesNotThrow(() => assertContractExpenseRecorder(mt, { responsibleUserIds: [mt.id] }))

// ── export ──────────────────────────────────────────────────────────────────
const exportRows = [
  {
    id: 1,
    amount: 1500.5,
    note: 'ค่าเช่า, กรกฎาคม',
    recordedBy: 'พลอย นารี',
    usageDate: '2026-07-05',
    usageMonth: '2026-07-01',
    createdAt: '2026-07-05T00:00:00Z',
  },
]

const csv = expenseCsv(exportRows)
// A note containing a comma must not shift the columns.
assert.match(csv, /"ค่าเช่า, กรกฎาคม"/)
assert.equal(csv.split('\n')[0], '﻿เดือน,วันที่,จำนวนเงิน,ผู้บันทึก,หมายเหตุ')
// Excel reads UTF-8 CSV as mojibake without a BOM.
assert.ok(csv.startsWith('﻿'), 'CSV needs a BOM for Excel')
// A quote inside a field must be doubled, not left to terminate the field.
assert.match(
  expenseCsv([{ ...exportRows[0], note: 'he said "hi"' }]),
  /"he said ""hi"""/,
)

const sheet = expenseSheetXml({ contractNumber: '150/69', displayName: null }, [
  { ...exportRows[0], note: 'a & b' },
])
assert.match(sheet, /ss:Name="150\/69"/)
assert.match(sheet, /a &amp; b/, 'ampersands must be escaped or Excel rejects the file')
assert.match(sheet, /<Data ss:Type="Number">1500\.50<\/Data>/)

console.log('contract budget domain tests passed')
