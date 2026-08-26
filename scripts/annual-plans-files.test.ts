import assert from 'node:assert/strict'
import {
  ANNUAL_PLAN_BUCKET,
  ANNUAL_PLAN_MIME_TYPE,
  MAX_ANNUAL_PLAN_FILE_SIZE_BYTES,
  annualPlanFilePath,
  isAnnualPlanFilePathAllowed,
  validateAnnualPlanFile,
} from '../lib/annual-plans/files'

assert.equal(ANNUAL_PLAN_BUCKET, 'lab-stock-annual-plans')
assert.equal(ANNUAL_PLAN_MIME_TYPE, 'application/pdf')
assert.equal(MAX_ANNUAL_PLAN_FILE_SIZE_BYTES, 25 * 1024 * 1024)

const path = annualPlanFilePath({
  fiscalYear: 2570,
  planType: 'procurement',
  fileName: '../../แผนจัดซื้อ 2570.pdf',
  id: 'plan-123',
})
assert.match(path, /^annual-plans\/2570\/procurement\/plan-123-/)
assert.ok(!path.includes('..'))
assert.doesNotMatch(path, /[^\x00-\x7F]/, 'Storage keys must remain ASCII-safe even when the display filename is Thai')
assert.equal(isAnnualPlanFilePathAllowed(path), true)
assert.equal(isAnnualPlanFilePathAllowed('annual-plans/2570/procurement/../other.pdf'), false)
assert.equal(isAnnualPlanFilePathAllowed('annual-plans/2570/hiring/plan.pdf'), true)
assert.equal(isAnnualPlanFilePathAllowed('other-bucket/2570/hiring/plan.pdf'), false)

async function main() {
  const validPdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], 'plan.pdf', {
    type: ANNUAL_PLAN_MIME_TYPE,
  })
  await validateAnnualPlanFile(validPdf)

  const wrongContent = new File(['not a pdf'], 'plan.pdf', { type: ANNUAL_PLAN_MIME_TYPE })
  await assert.rejects(() => validateAnnualPlanFile(wrongContent), /PDF/i)

  const wrongExtension = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'plan.txt', {
    type: ANNUAL_PLAN_MIME_TYPE,
  })
  await assert.rejects(() => validateAnnualPlanFile(wrongExtension), /PDF/i)

  console.log('annual plans file rules: ok')
}

void main()
