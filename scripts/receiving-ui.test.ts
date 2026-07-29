import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const listPage = read('app/(protected)/receipts/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</)
assert.match(listPage, /listGoodsReceipts\(/)
assert.match(listPage, /ค้นหา/, 'officers search by PO, PR, LS code, or name')
assert.doesNotMatch(listPage, /^['"]use client['"]/m)

const newPage = read('app/(protected)/receipts/new/page.tsx')
assert.match(newPage, /ReceiptForm/)
assert.match(newPage, /canOperateStock/, 'only stock officers and admins receive stock')

const detailPage = read('app/(protected)/receipts/[id]/page.tsx')
assert.match(detailPage, /params:\s*Promise</)
assert.match(detailPage, /PoImageUploader/)
assert.match(detailPage, /ReceiptLinesEditor|ReceiptPostPanel/)

const form = read('components/receipts/ReceiptForm.tsx')
assert.match(form, /^['"]use client['"]/m)
assert.match(form, /createGoodsReceipt/)
assert.match(form, /ReceiptLinesEditor/)
assert.doesNotMatch(form, /createBrowserClient|supabase\.from/)

const linesEditor = read('components/receipts/ReceiptLinesEditor.tsx')
assert.match(linesEditor, /เลขที่ล็อต/)
assert.match(linesEditor, /วันหมดอายุ/)
assert.match(linesEditor, /จัดเก็บที่/)
assert.match(linesEditor, /detectDuplicateLots/, 'duplicate lots must warn before posting')
assert.match(linesEditor, /ล็อตซ้ำ/)

const uploader = read('components/receipts/PoImageUploader.tsx')
assert.match(uploader, /^['"]use client['"]/m)
assert.match(uploader, /uploadPoImage/)
assert.match(
  uploader,
  /ยังไม่ได้แนบภาพใบสั่งซื้อ|แนบภาพใบสั่งซื้อ/,
  'the uploader must state whether evidence is attached',
)

const postPanel = read('components/receipts/ReceiptPostPanel.tsx')
assert.match(postPanel, /^['"]use client['"]/m)
assert.match(postPanel, /postGoodsReceipt/)
assert.match(postPanel, /isPending/, 'posting must lock while in flight')

const actions = read('lib/receipts/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /supabaseAdmin\.rpc\('create_goods_receipt'/)
assert.match(actions, /supabaseAdmin\.rpc\('post_goods_receipt'/)
assert.match(actions, /supabaseAdmin\.rpc\('set_goods_receipt_image'/)
assert.match(actions, /assertStockOperator/)
assert.match(actions, /isPoImagePathAllowed/, 'the server re-checks the upload path')
assert.match(
  actions,
  /createSignedUrl/,
  'private PO images are read through a short-lived signed URL',
)

const queries = read('lib/receipts/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /createClient/)
assert.doesNotMatch(queries, /supabaseAdmin/, 'receipt reads stay under RLS')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/receipts/)

console.log('receiving UI: ok')
