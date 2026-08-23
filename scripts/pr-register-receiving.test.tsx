import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { PurchaseRequestTable } from '../components/pr/PurchaseRequestTable'
import type { PurchaseRequestRecord } from '../lib/pr/types'

const baseRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  documentNumber: 'PR-2569-0022',
  poNumber: null,
  ephisPrNumber: 'Test123/5',
  requestedDate: '2026-08-03',
  requesterName: 'E2E Admin 9495',
  department: 'สำนักงานกลุ่มงานเทคนิคการแพทย์',
  status: 'completed',
  total: 721_000,
  methodDetails: {},
  items: [
    { receivedQuantity: 0, remainingQuantity: 1 },
    { receivedQuantity: 0, remainingQuantity: 2 },
  ],
} as PurchaseRequestRecord

const newContractHtml = renderToStaticMarkup(
  <PurchaseRequestTable requests={[{ ...baseRequest, purchaseMethod: 'e_bidding' }]} />,
)

assert.match(
  newContractHtml,
  /pr-receiving-summary__empty[^>]*>—<\/span>/,
  'a new-contract PR shows no receiving value in the desktop register',
)
assert.doesNotMatch(
  newContractHtml,
  /class="pr-receiving-summary(?:\s|")/,
  'a new-contract PR shows no receiving progress on either register layout',
)

const purchaseOrderHtml = renderToStaticMarkup(
  <PurchaseRequestTable requests={[{ ...baseRequest, purchaseMethod: 'off_plan' }]} />,
)

assert.match(purchaseOrderHtml, /รับแล้ว 0 จาก 2 รายการ/, 'a purchase-order PR keeps its desktop receiving summary')
assert.match(purchaseOrderHtml, /รับแล้ว 0\/2 รายการ/, 'a purchase-order PR keeps its mobile receiving summary')

console.log('purchase request register receiving: ok')
