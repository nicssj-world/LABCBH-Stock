import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import {
  buildPurchaseRequestCommitteePdfModel,
  generatePurchaseRequestCommitteePdf,
} from './committee-pdf'

const members = [
  { kind: 'specification' as const, seat: 1, name: 'นายทดสอบ หนึ่ง', positionTitle: 'นักเทคนิคการแพทย์ชำนาญการ' },
  { kind: 'result' as const, seat: 1, name: 'นางทดสอบ สอง', positionTitle: 'นักเทคนิคการแพทย์ปฏิบัติการ' },
  { kind: 'inspection' as const, seat: 1, name: 'นางสาวทดสอบ สาม', positionTitle: 'เจ้าพนักงานวิทยาศาสตร์การแพทย์' },
]

async function main() {
  const source = readFileSync(new URL('./committee-pdf.ts', import.meta.url), 'utf8')
  assert.match(source, /uniformTypography/, 'the PDF must calculate one shared font size')
  assert.equal(
    source.match(/size: typography\.fontSize/g)?.length,
    4,
    'header, section title, name, and position must use the same font size',
  )
  const contractModel = buildPurchaseRequestCommitteePdfModel({
    subjectName: 'สัญญาจัดซื้อน้ำยาตรวจวิเคราะห์',
    total: 125_000,
    members,
  })
  assert.deepEqual(contractModel.headerLines, [
    'เรื่อง สัญญาจัดซื้อน้ำยาตรวจวิเคราะห์',
    'วงเงิน 125,000.00 บาท',
  ])
  assert.equal(contractModel.groups.length, 3)
  assert.doesNotMatch(JSON.stringify(contractModel), /\.\.\./, 'the generated form must not contain dotted placeholders')
 
  const specificModel = buildPurchaseRequestCommitteePdfModel({ subjectName: null, total: 500_000, members })
  assert.deepEqual(specificModel.headerLines, ['เอกสารแนบกรณีวิธีเฉพาะเจาะจง ฯ (ไม่เกิน 5 แสน)'])
  assert.equal(specificModel.groups[0]?.title, 'คณะกรรมการกำหนดราคากลางและคุณลักษณะเฉพาะ')
  assert.deepEqual(
    buildPurchaseRequestCommitteePdfModel({ subjectName: null, total: 750_000, members }).headerLines,
    ['เอกสารแนบกรณีวิธีเฉพาะเจาะจง ฯ (ไม่เกิน 5 แสน)'],
    'when there is no contract name, the requested no-subject form is used regardless of the amount',
  )
 
  const leaseModel = buildPurchaseRequestCommitteePdfModel({
    subjectName: 'สัญญาเช่าเครื่องตรวจวิเคราะห์',
    total: null,
    members: members.filter((member) => member.kind !== 'result'),
  })
  assert.deepEqual(leaseModel.headerLines, ['เรื่อง สัญญาเช่าเครื่องตรวจวิเคราะห์'])
  assert.equal(leaseModel.groups.length, 2)
  const bytes = await generatePurchaseRequestCommitteePdf({
    subjectName: 'สัญญาเช่าเครื่องตรวจวิเคราะห์',
    total: null,
    members: members.filter((member) => member.kind !== 'result'),
  })
  assert.ok(bytes.byteLength > 5_000)
  const pdf = await PDFDocument.load(bytes)
  assert.equal(pdf.getPageCount(), 1)
  console.log('purchase request committee PDF: ok')
}

void main()
