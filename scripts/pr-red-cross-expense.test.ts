import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  hasDuplicatePurchaseRequestInvoice,
  canRecordPurchaseRequestExpense,
  purchaseRequestExpenseNetTotal,
  purchaseCreditNoteSourceOptions,
} from '../lib/pr/expense'
import { purchaseInvoiceSummaryTitle, buildPurchaseRequestInvoiceSummaryModel } from '../lib/pr/invoice-summary'
import { derivePurchaseRequestChecklist } from '../lib/pr/checklist'
import {
  PURCHASE_METHODS_BY_PURPOSE,
  contractTypeForMethod,
  purchaseMethodPurpose,
  purchaseMethodSchema,
} from '../lib/pr/schema'
import type { PurchaseRequestExpenseRecord } from '../lib/pr/types'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const migration = read('supabase/migrations/20260902120000_purchase_request_red_cross_expenses.sql')

const parsedMethod = purchaseMethodSchema.safeParse({ kind: 'red_cross' })
assert.equal(parsedMethod.success, true, 'red_cross must be a valid purchase method payload')
assert.equal(purchaseMethodPurpose('red_cross'), 'purchase_order')
assert.equal(contractTypeForMethod('red_cross'), null, 'Red Cross PR must not create a contract')
assert.ok(PURCHASE_METHODS_BY_PURPOSE.purchase_order.includes('red_cross'))

const checklist = derivePurchaseRequestChecklist('red_cross', 1_000_000)
assert.deepEqual(checklist.attachments.map((entry) => entry.kind), ['tor', 'quotation', 'quotation', 'quotation', 'plan_page'])
assert.deepEqual(checklist.committees.map((entry) => [entry.kind, entry.seats]), [
  ['specification', 3],
  ['inspection', 3],
])
const lowValueChecklist = derivePurchaseRequestChecklist('red_cross', 49_999.99)
assert.deepEqual(lowValueChecklist.attachments.map((entry) => entry.kind), ['tor', 'quotation', 'plan_page'])
assert.deepEqual(lowValueChecklist.committees.map((entry) => [entry.kind, entry.seats]), [
  ['specification', 1],
  ['inspection', 1],
])

const invoice: PurchaseRequestExpenseRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  purchaseRequestId: '00000000-0000-0000-0000-000000000010',
  expenseDate: '2026-09-01',
  amount: 500,
  invoiceNumber: 'INV-001',
  note: null,
  documentType: 'invoice',
  sourceExpenseId: null,
  status: 'active',
  actorName: 'ผู้บันทึก',
  createdAt: '2026-09-01T01:00:00.000Z',
  updatedAt: null,
  cancelledAt: null,
}
const credit: PurchaseRequestExpenseRecord = {
  ...invoice,
  id: '00000000-0000-0000-0000-000000000002',
  amount: 120,
  invoiceNumber: 'CN-001',
  documentType: 'credit_note',
  sourceExpenseId: invoice.id,
  createdAt: '2026-09-02T01:00:00.000Z',
}
assert.equal(purchaseRequestExpenseNetTotal([invoice, credit]), 380)
assert.equal(hasDuplicatePurchaseRequestInvoice([invoice, credit], ' inv-001 '), true)
assert.equal(hasDuplicatePurchaseRequestInvoice([invoice, credit], ' inv-001 ', invoice.id), false)
assert.equal(hasDuplicatePurchaseRequestInvoice([{ ...invoice, status: 'cancelled' }], 'INV-001'), true)
assert.deepEqual(purchaseCreditNoteSourceOptions([invoice, credit]), [{
  id: invoice.id,
  invoiceNumber: 'INV-001',
  originalAmount: 500,
  creditedAmount: 120,
  remainingAmount: 380,
}])
assert.equal(canRecordPurchaseRequestExpense({ status: 'completed', purchaseMethod: 'red_cross', poNumber: 'PO-1', poFileName: null }), true)
assert.equal(canRecordPurchaseRequestExpense({ status: 'pending', purchaseMethod: 'red_cross', poNumber: 'PO-1', poFileName: null }), false)
assert.equal(canRecordPurchaseRequestExpense({ status: 'received', purchaseMethod: 'red_cross', poNumber: null, poFileName: null }), false)

const summaryModel = buildPurchaseRequestInvoiceSummaryModel({
  documentNumber: 'PR-2569-0001',
  poNumber: 'PO-1',
  ephisPrNumber: null,
  items: [{ lineNumber: 1, lsCode: 'LS-1', name: 'น้ำยา A', requestedQuantity: 2, unit: 'ขวด', unitPrice: 500, lineTotal: 1000 }],
  expenseEvents: [invoice, credit],
})
assert.equal(summaryModel.title, 'น้ำยา A')
assert.equal(summaryModel.activeNetTotal, 380)
assert.equal(summaryModel.remaining, 620)
assert.equal(purchaseInvoiceSummaryTitle([{ name: 'น้ำยา A' }, { name: 'น้ำยา B' }]), 'น้ำยา A, น้ำยา B')
assert.equal(purchaseInvoiceSummaryTitle([]), 'รายการจัดซื้อ')

for (const required of [
  'create table if not exists public.purchase_request_expenses',
  'create table if not exists public.purchase_request_expense_audits',
  'purchase_request_expenses_invoice_unique',
  'record_purchase_request_expense(',
  'update_purchase_request_expense(',
  'cancel_purchase_request_expense(',
  'purchase_requests_guard_expense_reversal',
  'enable row level security',
  "'red_cross'",
]) assert.match(migration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `migration must include ${required}`)
assert.match(migration, /for update/i, 'expense mutations must serialize on the PR and its events')
assert.match(migration, /credit note exceeds remaining source invoice amount/i)
assert.match(migration, /active expenses exceed PR ceiling/i)
assert.match(migration, /before_data jsonb/i)
assert.match(migration, /case when target_request\.purchase_method in \('annual_plan', 'red_cross'\) then 1 else 0 end/i, 'Red Cross must use the annual-plan plan-page rule')
assert.doesNotMatch(migration, /service_purchase_request_invoice_numbers/i, 'purchase PR must not use the service invoice-summary counter')

const invoiceSummary = read('lib/pr/invoice-summary.ts')
assert.match(invoiceSummary, /names\.join\(', '\)/)
assert.match(invoiceSummary, /รายการจัดซื้อ/)
assert.doesNotMatch(invoiceSummary, /invoiceSummaryNumber/, 'purchase PDF must not carry a service summary running number')
assert.match(read('app/api/purchase-requests/[id]/invoice-summary/route.ts'), /generatePurchaseRequestInvoiceSummaryPdf/)

console.log('purchase request Red Cross expenses: ok')
