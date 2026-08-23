import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_purchase_request_outside_stock_receiving.sql'),
)

assert.equal(
  migrationNames.length,
  1,
  'outside-stock PR receiving must have one forward migration',
)

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')

for (const column of [
  'outside_stock_received_by',
  'outside_stock_received_at',
  'outside_stock_received_note',
]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`), `purchase_requests must carry ${column}`)
}

assert.match(sql, /purchase_requests_outside_stock_receipt_audit_check/i)
assert.match(sql, /outside_stock_received_note\s*=\s*'หน่วยงานรับของเอง'/i)
assert.match(sql, /status\s*=\s*'received'/i)

const receiveOutsideStock = sql.match(
  /create or replace function public\.mark_purchase_request_received_outside_stock[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(receiveOutsideStock, 'the authoritative outside-stock receiving RPC must exist')
assert.match(receiveOutsideStock, /language plpgsql/i)
assert.match(receiveOutsideStock, /security invoker/i)
assert.match(receiveOutsideStock, /set search_path = ''/i)
assert.match(receiveOutsideStock, /from public\.purchase_requests[\s\S]*?for update/i)
assert.ok(
  receiveOutsideStock.indexOf('for update') < receiveOutsideStock.indexOf('assert_purchase_request_manager'),
  'the RPC must lock and read the stored requester before authorizing the actor',
)
assert.match(
  receiveOutsideStock,
  /assert_purchase_request_manager\(p_actor_id, locked_request\.requester_id\)/i,
)
assert.match(
  receiveOutsideStock,
  /locked_request\.status = 'received'[\s\S]*?outside_stock_received_at is not null[\s\S]*?return locked_request/i,
  'a concurrent repeat after the first outside-stock transition must be an idempotent no-op',
)
assert.match(receiveOutsideStock, /locked_request\.status <> 'completed'/i)
assert.match(
  receiveOutsideStock,
  /locked_request\.purchase_method not in \(\s*'annual_plan',\s*'contract',\s*'awaiting_contract',\s*'off_plan'\s*\)/i,
)
assert.match(
  receiveOutsideStock,
  /receipt\.status in \('draft', 'posted'\)/i,
  'draft or posted warehouse receipts must block the outside-stock path',
)
assert.match(receiveOutsideStock, /set status = 'received'/i)
assert.match(receiveOutsideStock, /outside_stock_received_by = p_actor_id/i)
assert.match(receiveOutsideStock, /outside_stock_received_at = now\(\)/i)
assert.match(receiveOutsideStock, /outside_stock_received_note = 'หน่วยงานรับของเอง'/i)
assert.doesNotMatch(receiveOutsideStock, /purchase_request_items|received_quantity/i)
assert.doesNotMatch(receiveOutsideStock, /inventory_lots|stock_movements/i)
assert.doesNotMatch(receiveOutsideStock, /insert\s+into\s+public\.goods_receipts/i)

for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(
      `revoke execute on function public\\.mark_purchase_request_received_outside_stock\\(uuid, uuid\\) from ${role}`,
      'i',
    ),
  )
}
assert.match(
  sql,
  /grant execute on function public\.mark_purchase_request_received_outside_stock\(uuid, uuid\) to service_role/i,
)

const clearPoFile = sql.match(
  /create or replace function public\.clear_purchase_request_po_file[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(clearPoFile, 'the migration must carry forward PO cleanup with outside-stock owner authorization')
assert.match(
  clearPoFile,
  /outside_stock_received_at is not null[\s\S]*?assert_purchase_request_manager\(p_actor_id, locked_request\.requester_id\)/i,
)
assert.match(
  clearPoFile,
  /else[\s\S]*?assert_stock_officer_actor\(p_actor_id\)/i,
  'ordinary posted-receipt and short-close cleanup must remain stock-operator-only',
)

const read = (path: string) => {
  const absolutePath = join(process.cwd(), path)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}
const types = read('lib/pr/types.ts')
const queries = read('lib/pr/queries.ts')
const authorization = read('lib/pr/authorization.ts')
const actions = read('lib/pr/actions.ts')
const poFileActions = read('lib/pr/po-file-actions.ts')
const errors = read('lib/pr/errors.ts')
const control = read('components/pr/PurchaseRequestOutsideStockReceiveControl.tsx')
const summary = read('components/pr/PurchaseRequestSummaryDialog.tsx')
const table = read('components/pr/PurchaseRequestTable.tsx')
const listPage = read('app/(protected)/purchase-requests/page.tsx')
const detailPage = read('app/(protected)/purchase-requests/[id]/page.tsx')

for (const field of [
  'outsideStockReceivedBy',
  'outsideStockReceivedByName',
  'outsideStockReceivedAt',
  'outsideStockReceivedNote',
]) {
  assert.match(types, new RegExp(`\\b${field}\\b`), `PurchaseRequestRecord must expose ${field}`)
}
for (const field of [
  'outside_stock_received_by',
  'outside_stock_received_at',
  'outside_stock_received_note',
]) {
  assert.match(queries, new RegExp(`\\b${field}\\b`), `PR reads must select ${field}`)
}
assert.match(queries, /outside_stock_receiver:profiles!purchase_requests_outside_stock_received_by_fkey/)
assert.match(authorization, /canReceivePurchaseRequestOutsideStock/)
assert.match(authorization, /assertPurchaseRequestOutsideStockReceiver/)

assert.match(actions, /export async function receivePurchaseRequestOutsideStock/)
assert.match(actions, /assertPurchaseRequestOutsideStockReceiver/)
assert.match(actions, /supabaseAdmin\.rpc\('mark_purchase_request_received_outside_stock'/)
assert.match(actions, /cleanupTerminalPurchaseRequestPoFile/)
assert.match(actions, /reason: 'received'/)
assert.match(actions, /receiptId: null/)
assert.match(actions, /รับของโดยหน่วยงานสำเร็จ แต่ล้างไฟล์ PO ไม่สำเร็จ/)
assert.match(errors, /only a confirmed purchase request can be received outside stock/)
assert.match(errors, /cancel the open or posted goods receipt before receiving outside stock/)

assert.match(poFileActions, /outside_stock_received_at/)
assert.match(poFileActions, /request\.outside_stock_received_at[\s\S]*?assertPurchaseRequestOutsideStockReceiver/)
assert.match(poFileActions, /else[\s\S]*?assertStockOperator/)

assert.match(control, /^['"]use client['"]/m)
assert.doesNotMatch(control, /from '@\/lib\/pr\/(?:actions|po-file-actions)'/)
assert.doesNotMatch(control, /fetch\(/, 'the client control must retain the Server Action boundary')
assert.match(control, /receiveAction\(requestId\)/)
assert.match(control, /retryCleanupAction\(requestId\)/)
assert.match(control, /หน่วยงานรับของเอง/)
assert.match(control, /ไม่เพิ่มยอดคงคลัง/)
assert.match(control, /สถานะรับครบ/)
assert.match(control, /ย้อนกลับไม่ได้/)
assert.match(control, /Stock Movement/)
assert.match(control, /<dialog\b/)
assert.match(control, /createPortal/)
assert.match(control, /router\.refresh\(\)/)
assert.equal(
  existsSync(join(process.cwd(), 'app/api/purchase-requests/[id]/outside-stock-receiving/route.ts')),
  false,
  'outside-stock writes must not bypass the requested Server Action boundary through a Route Handler',
)

assert.match(summary, /PurchaseRequestOutsideStockReceiveControl/)
assert.match(summary, /หมายเหตุจากผู้ขอ/)
assert.match(summary, /หมายเหตุระบบ/)
assert.match(summary, /outsideStockReceivedNote/)
assert.match(summary, /หน่วยงานรับของเอง · ไม่เข้าคลัง/)

assert.match(table, /canReceivePurchaseRequestOutsideStock/)
assert.match(table, /outsideStockReceivedAt/)
assert.match(table, /รับเอง/)
assert.match(table, /ไม่เข้าคลัง/)
assert.match(listPage, /<PurchaseRequestTable[\s\S]*?actor=\{actor\}/)
assert.match(listPage, /receivePurchaseRequestOutsideStock/)
assert.match(listPage, /retryPurchaseRequestPoFileCleanup/)

assert.match(detailPage, /PurchaseRequestOutsideStockReceiveControl/)
assert.match(detailPage, /receivePurchaseRequestOutsideStock/)
assert.match(detailPage, /retryPurchaseRequestPoFileCleanup/)
assert.match(detailPage, /หมายเหตุจากผู้ขอ/)
assert.match(detailPage, /หมายเหตุระบบ/)
assert.match(detailPage, /outsideStockReceivedByName/)
assert.match(detailPage, /outsideStockReceivedAt/)
assert.match(detailPage, /หน่วยงานรับของเอง จึงไม่มีใบรับเข้าคลัง/)
assert.match(detailPage, /ไม่เข้าคลัง/)

console.log(`purchase request outside-stock receiving: ok (${migrationNames[0]})`)
