import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_lab_stock_receiving.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one receiving migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')
const partialReceivingNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_partial_receiving_compatibility.sql'),
)
assert.equal(partialReceivingNames.length, 1, 'exactly one partial-receiving compatibility migration must exist')
const partialReceivingSql = readFileSync(join(migrationsDir, partialReceivingNames[0]), 'utf8')
const poLifecycleNames = readdirSync(migrationsDir).filter((name) =>
  name.includes('purchase_request_po_file_lifecycle') && name.endsWith('.sql'),
)
assert.equal(poLifecycleNames.length, 1, 'exactly one PR PO lifecycle migration must exist')
const poLifecycleSql = readFileSync(join(migrationsDir, poLifecycleNames[0]), 'utf8')

const TABLES = ['goods_receipts', 'goods_receipt_items']

for (const table of TABLES) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'))
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'))
  assert.match(sql, new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'))
  assert.match(
    sql,
    new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'),
  )
  assert.match(
    sql,
    new RegExp(`create policy ${table}_app_read\\s+on public\\.${table} for select\\s+to authenticated`, 'i'),
  )
}

assert.doesNotMatch(compactSql, /grant (?:select, )?(?:insert|update|delete)[^;]* to authenticated/i)
// Scoped to public tables. storage.objects legitimately needs INSERT/UPDATE for
// authenticated uploaders; that path is guarded by its own membership predicate
// and covered by scripts/storage-policy.test.ts.
assert.doesNotMatch(
  compactSql,
  /create policy [^;]+ on public\.\w+ for (?:insert|update|delete|all) to authenticated/i,
)
assert.doesNotMatch(sql, /security definer/i)
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data/i)

// Header: PO/PR reference, receiver, date, image path, status.
for (const column of [
  'purchase_request_id',
  'po_number',
  'received_date',
  'received_by',
  'department',
  'po_image_path',
  'status',
]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`), `goods_receipts must carry ${column}`)
}
for (const status of ['draft', 'posted', 'cancelled']) {
  assert.match(sql, new RegExp(`'${status}'`))
}
for (const column of ['cancelled_by', 'cancelled_at', 'cancellation_note']) {
  assert.match(partialReceivingSql, new RegExp(`\\b${column}\\b`), `goods_receipts must carry ${column}`)
}

// Lines describe the lot that receiving will create.
for (const column of [
  'inventory_item_id',
  'lot_number',
  'expiry_date',
  'quantity',
  'unit',
  'storage_location',
  'inventory_lot_id',
]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`), `goods_receipt_items must carry ${column}`)
}
assert.match(sql, /quantity numeric\(15,3\) not null check \(quantity > 0\)/i)
assert.match(
  sql,
  /create unique index if not exists goods_receipt_items_lot_key/i,
  'one receipt cannot list the same item and lot twice',
)

const receivingIntegrityNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_receiving_integrity.sql'),
)
assert.equal(receivingIntegrityNames.length, 1, 'exactly one receiving-integrity migration must exist')
const receivingIntegritySql = readFileSync(join(migrationsDir, receivingIntegrityNames[0]), 'utf8')
assert.match(receivingIntegritySql, /goods_receipts_active_purchase_request_key/i)
assert.match(receivingIntegritySql, /create or replace function public\.create_goods_receipt/i)
assert.match(receivingIntegritySql, /locked_request.*for update|for update[\s\S]*locked_request/i)
assert.match(partialReceivingSql, /drop index if exists public\.goods_receipts_active_purchase_request_key/i)
assert.match(
  partialReceivingSql,
  /create unique index if not exists goods_receipts_one_draft_purchase_request_key[\s\S]*?status = 'draft'/i,
  'one PR may have many posted receipts but only one open draft',
)
assert.match(partialReceivingSql, /drop index if exists public\.goods_receipts_po_number_key/i)

for (const column of [
  'po_file_path',
  'po_file_name',
  'po_file_mime_type',
  'po_file_size_bytes',
  'po_file_checksum',
  'po_file_uploaded_by',
  'po_file_uploaded_at',
  'po_file_deleted_by',
  'po_file_deleted_at',
  'po_file_deletion_reason',
  'po_file_deleted_receipt_id',
]) {
  assert.match(poLifecycleSql, new RegExp(`\\b${column}\\b`), `PR PO audit metadata must include ${column}`)
}
assert.match(poLifecycleSql, /create or replace function public\.set_purchase_request_po_file/i)
assert.match(poLifecycleSql, /create or replace function public\.clear_purchase_request_po_file/i)
assert.match(poLifecycleSql, /lab-stock-po/i, 'the PR PO file RPCs must remain compatible with the private PO bucket')
assert.match(poLifecycleSql, /closed_short/i, 'terminal cleanup must support short-close PRs')
for (const fn of ['set_purchase_request_po_file', 'clear_purchase_request_po_file']) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      poLifecycleSql,
      new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\)\\s+from[\\s\\S]*?${role}`, 'i'),
      `${fn} must not be callable by ${role}`,
    )
  }
  assert.match(
    poLifecycleSql,
    new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+[\\s\\S]*?to service_role`, 'i'),
  )
}

// Posting is atomic, idempotent, and service-role only.
const postFunction = partialReceivingSql.match(
  /create or replace function public\.post_goods_receipt[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(postFunction, 'post_goods_receipt must exist')
assert.match(postFunction, /security invoker/i)
assert.match(postFunction, /set search_path = ''/i)
assert.match(postFunction, /assert_stock_officer_actor/i)
assert.match(postFunction, /for update/i)
assert.match(postFunction, /status <> 'draft'/i)
assert.match(postFunction, /insert into public\.inventory_lots/i)
assert.match(postFunction, /insert into public\.stock_movements/i)
assert.match(postFunction, /'goods_receipt'/i)
assert.match(postFunction, /'posted'/i)
assert.ok(
  postFunction.indexOf('for update') < postFunction.indexOf('insert into public.inventory_lots'),
  'the receipt must be locked before any lot is created',
)

// Re-posting must be a no-op, not a duplicate movement. The Task 5 unique index
// on (source document, item, lot) is what makes that true.
assert.match(
  postFunction,
  /on conflict[\s\S]{0,200}do nothing/i,
  'a retried post must not duplicate movements',
)
assert.match(postFunction, /source_document_id/i)
assert.match(postFunction, /'goods_receipt'::text|source_document_type/i)

for (const fn of ['post_goods_receipt', 'create_goods_receipt']) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      partialReceivingSql,
      new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from[^;]*${role}`, 'i'),
      `${fn} must remain revoked from ${role}`,
    )
  }
  assert.match(
    partialReceivingSql,
    new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`, 'i'),
  )
}

for (const fn of ['set_goods_receipt_image']) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from ${role}`, 'i'),
      `${fn} must be revoked from ${role}`,
    )
  }
  assert.match(
    sql,
    new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`, 'i'),
  )
}

const cancelFunction = partialReceivingSql.match(
  /create or replace function public\.cancel_goods_receipt[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(cancelFunction, 'cancel_goods_receipt must exist')
assert.match(cancelFunction, /status <> 'draft'/i, 'only drafts may be cancelled')
assert.match(cancelFunction, /cancelled_by = p_actor_id/i)
assert.match(cancelFunction, /cancelled_at = now\(\)/i)
assert.match(cancelFunction, /cancellation_note = nullif/i, 'the optional cancellation note is audited when present')
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    partialReceivingSql,
    new RegExp(`revoke execute on function public\\.cancel_goods_receipt\\([^)]*\\) from[^;]*${role}`, 'i'),
  )
}
assert.match(partialReceivingSql, /grant execute on function public\.cancel_goods_receipt[\s\S]*?to service_role/i)

// Lots gain their real link back to the receipt line now that it exists.
assert.match(
  sql,
  /alter table public\.inventory_lots[\s\S]*?foreign key \(goods_receipt_item_id\)[\s\S]*?references public\.goods_receipt_items\(id\)/i,
)

for (const index of [
  'goods_receipts_status_idx',
  'goods_receipts_purchase_request_idx',
  'goods_receipt_items_receipt_idx',
  'goods_receipt_items_inventory_item_idx',
]) {
  assert.match(sql, new RegExp(`create index if not exists ${index}`, 'i'))
}

console.log(`receiving schema: ok (${migrationNames[0]})`)
