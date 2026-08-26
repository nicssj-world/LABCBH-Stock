import assert from 'node:assert/strict'
import { fiscalYearOfDate, fiscalYearOfIsoDate } from '../lib/annual-plans/fiscal'
import {
  annualPlanReferenceSchema,
  matchAnnualPlanContractName,
  matchAnnualPlanLine,
  type AnnualPlanRow,
} from '../lib/annual-plans/pr-reference'

const row = (overrides: Partial<AnnualPlanRow>): AnnualPlanRow => ({
  id: '00000000-0000-0000-0000-000000000001',
  lineNumber: 1,
  planSequence: '1',
  itemName: 'น้ำยาตรวจ CBC',
  lsCode: 'LS046022',
  rawText: '1 น้ำยาตรวจ CBC LS046022',
  pageNumber: 1,
  pageWidth: 595,
  pageHeight: 842,
  x: 20,
  y: 700,
  width: 300,
  height: 18,
  ...overrides,
})

// Bangkok's 1 October boundary is the only date that changes the FY.
assert.equal(fiscalYearOfDate(new Date('2026-09-30T16:59:59.000Z')), 2569)
assert.equal(fiscalYearOfDate(new Date('2026-09-30T17:00:00.000Z')), 2570)
assert.equal(fiscalYearOfIsoDate('2026-09-30'), 2569)
assert.equal(fiscalYearOfIsoDate('2026-10-01'), 2570)

const named = row({})
assert.equal(matchAnnualPlanLine('น้ำยาตรวจ CBC', '', [named]).selected?.id, named.id)
assert.equal(matchAnnualPlanLine('น้ำยาตรวจ CBC', '', [named]).matchMethod, 'name_exact')

const planWithoutCode = row({
  id: '00000000-0000-0000-0000-000000000007',
  lsCode: null,
  rawText: '7 น้ำยาที่จะได้รับรหัสภายหลัง',
  itemName: 'น้ำยาที่จะได้รับรหัสภายหลัง',
  planSequence: '7',
  lineNumber: 7,
})
assert.equal(
  matchAnnualPlanLine('น้ำยาที่จะได้รับรหัสภายหลัง', 'LS000007', [planWithoutCode]).selected?.id,
  planWithoutCode.id,
  'a plan row without an LS code must still match by name',
)
assert.equal(matchAnnualPlanLine('น้ำยาที่จะได้รับรหัสภายหลัง', 'LS000007', [planWithoutCode]).matchMethod, 'name_exact')

const codeOnly = row({
  id: '00000000-0000-0000-0000-000000000002',
  itemName: 'ชื่อเดิมในแผน',
  rawText: '2 ชื่อเดิมในแผน LS078901',
  lsCode: 'LS078901',
  planSequence: '2',
  lineNumber: 2,
})
assert.equal(matchAnnualPlanLine('ชื่อจากคลังรุ่นใหม่', 'ls-078901', [codeOnly]).selected?.id, codeOnly.id)
assert.equal(matchAnnualPlanLine('ชื่อจากคลังรุ่นใหม่', 'ls-078901', [codeOnly]).matchMethod, 'code_exact')

const conflictingCode = row({
  id: '00000000-0000-0000-0000-000000000006',
  lsCode: 'LS099999',
  rawText: '6 น้ำยาตรวจ CBC LS099999',
  lineNumber: 6,
  planSequence: '6',
})
assert.equal(matchAnnualPlanLine('น้ำยาตรวจ CBC', 'LS046022', [conflictingCode]).selected, null)
assert.equal(matchAnnualPlanLine('น้ำยาตรวจ CBC', 'LS046022', [conflictingCode]).candidates[0].id, conflictingCode.id)

const duplicateA = row({
  id: '00000000-0000-0000-0000-000000000003',
  planSequence: '3',
  lineNumber: 3,
})
const duplicateB = row({
  id: '00000000-0000-0000-0000-000000000004',
  planSequence: '4',
  lineNumber: 4,
  lsCode: null,
})
const ambiguous = matchAnnualPlanLine('น้ำยาตรวจ CBC', '', [duplicateA, duplicateB])
assert.equal(ambiguous.selected, null)
assert.equal(ambiguous.matchMethod, null)
assert.deepEqual(ambiguous.candidates.map((candidate) => candidate.planSequence), ['3', '4'])

// A new catalogue row is matched through the same name/code path as an
// existing row; inventory identity is deliberately absent from this matcher.
const newCatalogue = row({
  id: '00000000-0000-0000-0000-000000000005',
  itemName: 'น้ำยาใหม่ยังไม่เข้าคลัง',
  rawText: '5 น้ำยาใหม่ยังไม่เข้าคลัง LS099001',
  lsCode: 'LS099001',
  planSequence: '5',
  lineNumber: 5,
})
assert.equal(matchAnnualPlanLine('น้ำยาใหม่ยังไม่เข้าคลัง', 'LS099001', [newCatalogue]).selected?.id, newCatalogue.id)

const hiringContract = row({
  id: '00000000-0000-0000-0000-000000000008',
  itemName: 'สัญญาเช่าเครื่องตรวจอัตโนมัติ รุ่น X',
  rawText: '8 สัญญาเช่าเครื่องตรวจอัตโนมัติ รุ่น X',
  lsCode: null,
  planSequence: '8',
  lineNumber: 8,
})
assert.equal(
  matchAnnualPlanContractName('สัญญาเช่าเครื่องตรวจอัตโนมัติ รุ่น X', [hiringContract]).selected?.id,
  hiringContract.id,
  'hiring plan matching must use the contract name even without an LS code',
)
assert.equal(matchAnnualPlanContractName('ชื่อสัญญาที่ไม่มีในแผน', [hiringContract]).selected, null)
assert.throws(() => annualPlanReferenceSchema.parse({
  planVersionId: '00000000-0000-0000-0000-000000000001',
  planFiscalYear: 2569,
  planType: 'hiring',
  lines: [],
  contract: {
    contractName: 'สัญญาเช่าเครื่องตรวจอัตโนมัติ รุ่น X',
    line: {
      lineNumber: 8,
      planRowId: hiringContract.id,
      matchMethod: 'code_exact',
    },
  },
}), 'hiring plan references must not use an LS-code match')

console.log('annual plan reference matching and fiscal boundaries: ok')
