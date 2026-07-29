import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const listPage = read('app/(protected)/purchase-requests/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(listPage, /listPurchaseRequests\(/)
assert.match(listPage, /ค้นหา/, 'stock officers search by PO, PR, LS code, or name')
assert.match(listPage, /PurchaseRequestTable/)
assert.doesNotMatch(listPage, /^['"]use client['"]/m)

const newPage = read('app/(protected)/purchase-requests/new/page.tsx')
assert.match(newPage, /PurchaseRequestForm/)
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
assert.doesNotMatch(form, /createBrowserClient|supabase\.from/)

const methodFields = read('components/pr/PurchaseMethodFields.tsx')
assert.match(methodFields, /PURCHASE_METHOD_LABELS/, 'the six methods come from the shared presenter')
assert.match(methodFields, /planSequence/)
assert.match(methodFields, /purchaseSequence/)

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
assert.doesNotMatch(queries, /supabaseAdmin/, 'PR reads stay under RLS')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/purchase-requests/)

console.log('purchase request UI: ok')
