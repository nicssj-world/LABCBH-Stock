import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatPurchaseRequestMutationError } from '@/lib/pr/errors'

const read = (path: string) => readFileSync(path, 'utf8')

const duplicatePoError = 'duplicate key value violates unique constraint "purchase_requests_po_number_key"'

assert.equal(
  formatPurchaseRequestMutationError('บันทึกเลขที่ใบสั่งซื้อ (PO)', duplicatePoError),
  'บันทึกเลขที่ใบสั่งซื้อ (PO) ไม่สำเร็จ: เลขที่ใบสั่งซื้อ (PO) นี้ถูกใช้กับใบ PR อื่นแล้ว ไม่สามารถใช้เลขซ้ำได้ กรุณาตรวจสอบเลข PO',
)

const actions = read('lib/pr/actions.ts')
assert.match(
  actions,
  /if \(result\.error\) \{[\s\S]*?return \{[\s\S]*?ok: false/,
  'saving a duplicate PO must return an expected action error instead of throwing through a production Server Action',
)

const review = read('components/pr/PrReviewPanel.tsx')
assert.match(review, /isPurchaseRequestActionError/)
assert.match(review, /const result = await operation\(\)/)
assert.match(review, /if \(isPurchaseRequestActionError\(result\)\)/)

console.log('purchase request PO number errors: ok')
