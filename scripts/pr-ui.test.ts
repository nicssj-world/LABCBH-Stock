import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const listPage = read('app/(protected)/purchase-requests/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(listPage, /listPurchaseRequests\(/)
assert.match(listPage, /ค้นหา/, 'stock officers search by PO, PR, LS code, or name')
assert.match(listPage, /หน่วยงาน/, 'stock officers can filter purchase requests by department')
assert.match(listPage, /AutoFilterBench/, 'purchase-request filters must update the list immediately')
assert.doesNotMatch(listPage, /แสดงผล/, 'purchase-request filters must not require an apply button')
assert.match(listPage, /PurchaseRequestTable/)
assert.doesNotMatch(listPage, /^['"]use client['"]/m)

const newPage = read('app/(protected)/purchase-requests/new/page.tsx')
assert.match(newPage, /PurchaseRequestForm/)
assert.match(newPage, /DEPARTMENTS/)
assert.match(newPage, /departments=\{DEPARTMENTS\}/)
assert.match(newPage, /listNextContractPurchaseSequences/)
assert.match(newPage, /eBiddingContracts/)
assert.match(newPage, /assertPurchaseRequester|canRequestPurchase/, 'only heads and admins may draft a PR')

const detailPage = read('app/(protected)/purchase-requests/[id]/page.tsx')
assert.match(detailPage, /params:\s*Promise</)
assert.match(detailPage, /PrReviewPanel/)
assert.match(detailPage, /canOperateStock/, 'only stock officers and admins confirm')

const form = read('components/pr/PurchaseRequestForm.tsx')
assert.match(form, /^['"]use client['"]/m)
assert.match(form, /createPurchaseRequest/)
assert.match(form, /PurchaseMethodFields/)
assert.match(form, /ContractItemPicker/)
assert.match(form, /departments: readonly string\[\]/)
assert.match(form, /<select required value=\{department\}/)
assert.match(form, /\{departments\.map\(\(department\)/)
assert.doesNotMatch(form, /<input type="text" required value=\{department\}/)
assert.match(form, /หัวหน้างาน/, 'the requester header labels the supervisor as หัวหน้างาน')
assert.match(form, /ยอดในสัญญาจะถูกตัดเมื่อเจ้าหน้าที่คลังยืนยันเท่านั้น/)
assert.match(form, /<span>ยอดรวม<\/span>/)
assert.doesNotMatch(form, /ยอดรวมทั้งใบ PR/)
assert.doesNotMatch(form, /createBrowserClient|supabase\.from/)
assert.match(
  form,
  /method\.kind === 'contract' \|\| method\.kind === 'e_bidding'/,
  'E-Bidding must use the selected contract items, not the full catalogue',
)

const styles = read('app/globals.css')
assert.match(
  styles,
  /\.bench-panel > \.form-grid\s*\{[\s\S]*?padding:\s*20px;[\s\S]*?\}/,
  'form fields inside a panel need inset space from the panel border',
)
assert.match(
  styles,
  /\.method-detail-grid select\s*\{[\s\S]*?border:\s*1px solid var\(--lab-border-strong\);[\s\S]*?\}/,
  'the contract selector needs the same visible border as other method fields',
)
assert.match(
  styles,
  /\.bench-panel > \.items-editor__grand-total\s*\{[\s\S]*?margin:\s*18px 20px 20px;[\s\S]*?\}/,
  'the PR total needs inset space from the panel edge',
)

const methodFields = read('components/pr/PurchaseMethodFields.tsx')
assert.match(methodFields, /PURCHASE_METHOD_LABELS/, 'the six methods come from the shared presenter')
assert.match(methodFields, /planSequence/)
assert.match(methodFields, /purchaseSequence/)
assert.match(methodFields, /readOnly/)
assert.match(methodFields, /eBiddingContracts/)
assert.match(methodFields, /method\.kind === 'e_bidding'/)

const picker = read('components/pr/ContractItemPicker.tsx')
assert.match(picker, /คงเหลือในสัญญา/, 'the picker must show remaining contracted quantity')
assert.match(picker, /ยอดคงเหลือในคลัง/, 'and current on-hand, so nothing is retyped')
assert.match(picker, /เบิกเฉลี่ย/, 'and rolling usage')

const review = read('components/pr/PrReviewPanel.tsx')
assert.match(review, /^['"]use client['"]/m)
assert.match(review, /confirmPurchaseRequest/)
assert.match(review, /คงเหลือหลังยืนยัน/, 'the officer sees contract balance before and after')

const presenter = read('lib/pr/presenter.ts')
assert.match(presenter, /แผนจัดซื้อประจำปี/)
assert.match(presenter, /ตามสัญญา/)
assert.match(presenter, /นอกแผน/)
assert.match(presenter, /รอทำสัญญา/)
assert.match(presenter, /ต่ำกว่าขั้นต่ำ|ควรทำ PR/, 'minimum-stock warning wording lives with the labels')

const actions = read('lib/pr/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /supabaseAdmin\.rpc\('create_purchase_request'/)
assert.match(actions, /supabaseAdmin\.rpc\('confirm_purchase_request'/)
assert.match(actions, /supabaseAdmin\.rpc\('reverse_purchase_request'/)
assert.match(actions, /supabaseAdmin\.rpc\('set_purchase_order_number'/)
assert.match(actions, /assertPurchaseRequester/)
assert.match(actions, /assertStockOperator/)

const queries = read('lib/pr/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /createClient/)
assert.match(queries, /department\?: string/, 'purchase-request queries accept a department filter')
assert.match(queries, /filters\.department/, 'purchase-request queries apply the department filter')
assert.match(queries, /listNextContractPurchaseSequences/)
assert.doesNotMatch(queries, /supabaseAdmin/, 'PR reads stay under RLS')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/purchase-requests/)

console.log('purchase request UI: ok')
