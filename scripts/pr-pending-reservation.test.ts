import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatPurchaseRequestMutationError } from '@/lib/pr/errors'

const read = (path: string) => readFileSync(path, 'utf8')

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir).find((file) => file.endsWith('_pr_pending_reservations.sql'))
assert.ok(migrationName, 'the pending-reservation migration must exist')
const migration = read(join(migrationsDir, migrationName!))

assert.match(
  migration,
  /create index if not exists purchase_request_items_contract_pending_idx\s+on public\.purchase_request_items/i,
  'pending reservation checks need an index by contract item and PR',
)

const reservationGuard = migration.match(
  /create or replace function public\.validate_purchase_request_item_contract_reservation[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(reservationGuard, 'the purchase-request item reservation guard must exist')
assert.match(reservationGuard!, /from public\.contract_items[\s\S]*?for update/i)
assert.match(reservationGuard!, /from public\.contract_item_allocations/i)
assert.match(reservationGuard!, /from public\.purchase_request_items/i)
assert.match(reservationGuard!, /request\.status = 'pending'/i)
assert.match(reservationGuard!, /request\.id <> new\.purchase_request_id/i)
assert.match(
  reservationGuard!,
  /committed_quantity \+ pending_quantity \+ new\.requested_quantity > contract_item_row\.quantity/i,
  'a new or edited PR line must include other pending reservations in the ceiling',
)
assert.ok(
  reservationGuard!.indexOf('for update') < reservationGuard!.indexOf('from public.purchase_request_items'),
  'the contract item must be locked before pending reservations are summed',
)
assert.match(
  migration,
  /create trigger purchase_request_items_contract_reservation\s+before insert or update of purchase_request_id, contract_item_id, requested_quantity/i,
)

const pendingQuantityGuard = migration.match(
  /create or replace function public\.guard_contract_item_pending_quantity[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(pendingQuantityGuard, 'contract quantity edits must account for pending reservations')
assert.match(pendingQuantityGuard!, /request\.status = 'pending'/i)
assert.match(pendingQuantityGuard!, /committed_quantity \+ pending_quantity/i)
assert.match(
  migration,
  /create trigger contract_items_guard_pending_quantity\s+before update of quantity on public\.contract_items/i,
)

const queries = read('lib/pr/queries.ts')
assert.match(queries, /purchase_request_items\s*\([\s\S]*?requested_quantity[\s\S]*?purchase_requests\s*\(id, status\)/i)
assert.match(queries, /excludePurchaseRequestId/i)
assert.match(queries, /pendingReserved/i)

const formOptions = read('lib/pr/form-options.ts')
assert.match(formOptions, /loadPurchaseRequestFormOptions\(excludePurchaseRequestId\?: string\)/)
assert.match(formOptions, /listContractItemOptions\(undefined, excludePurchaseRequestId\)/)

const editPage = read('app/(protected)/purchase-requests/[id]/edit/page.tsx')
assert.match(editPage, /loadPurchaseRequestFormOptions\(request\.id\)/)
assert.match(editPage, /options\.contractLines\.find\([\s\S]*?contractItemId === item\.contractItemId/)

const actions = read('lib/pr/actions.ts')
assert.match(actions, /formatPurchaseRequestMutationError/)

const errors = read('lib/pr/errors.ts')
assert.match(errors, /allocation exceeds contracted quantity/)
assert.match(errors, /purchase request quantity exceeds contract remaining after pending reservations/)
assert.match(errors, /จำนวนที่ขอรวมกับ PR ที่รอยืนยันเกินจำนวนคงเหลือในสัญญา/)
assert.match(errors, /return `\$\{operation\} ไม่สำเร็จ:/)
assert.equal(
  formatPurchaseRequestMutationError('ยืนยันใบ PR', 'allocation exceeds contracted quantity'),
  'ยืนยันใบ PR ไม่สำเร็จ: ยอดคงเหลือในสัญญาไม่พอสำหรับจำนวนที่ขอ อาจมี PR อื่นถูกยืนยันไปแล้ว',
)
assert.equal(
  formatPurchaseRequestMutationError(
    'สร้างใบ PR',
    'purchase request quantity exceeds contract remaining after pending reservations',
  ),
  'สร้างใบ PR ไม่สำเร็จ: จำนวนที่ขอรวมกับ PR ที่รอยืนยันเกินจำนวนคงเหลือในสัญญา',
)

console.log('purchase request pending reservation contract: ok')
