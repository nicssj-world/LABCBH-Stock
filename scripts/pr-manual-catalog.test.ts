import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { purchaseRequestInputSchema } from '../lib/pr/schema'

const manualLine = {
  inventoryItemId: null,
  lsCode: 'LS-NEW-001',
  name: 'น้ำยารายการใหม่',
  contractItemId: null,
  requestedQuantity: 2,
  unit: 'ขวด',
  unitPrice: 125,
}

const request = {
  department: 'กลุ่มงานเทคนิคการแพทย์',
  headName: 'หัวหน้างาน',
  requestedDate: '2026-08-20',
  note: null,
  method: { kind: 'off_plan' as const },
  items: [manualLine],
}

assert.equal(
  purchaseRequestInputSchema.safeParse(request).success,
  true,
  'a PR may carry a manually entered reagent line without an inventory UUID',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...request,
    items: [{ ...manualLine, lsCode: null }],
  }).success,
  false,
  'a manually entered line must include its LS code',
)
assert.equal(
  purchaseRequestInputSchema.safeParse({
    ...request,
    items: [manualLine, { ...manualLine, lsCode: 'ls new 001' }],
  }).success,
  false,
  'normalized LS codes cannot be repeated in one PR',
)

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir).find((name) => name.endsWith('_pr_manual_catalog_items.sql'))
assert.ok(migrationName, 'the PR manual catalogue migration must exist')
const migration = readFileSync(join(migrationsDir, migrationName!), 'utf8')

assert.match(migration, /create or replace function public\.create_purchase_request/i)
assert.match(migration, /insert into public\.inventory_items/i)
assert.match(migration, /on conflict do nothing/i)
assert.match(migration, /resolved_inventory_item_id/i)
assert.match(migration, /'source', 'purchase_request'/i)
assert.match(migration, /is_active,\s*note,\s*source_metadata/i)
assert.match(migration, /true,\s*null,\s*jsonb_build_object\(/i, 'PR-created catalogue rows leave the user-facing note blank')
assert.doesNotMatch(migration, /สร้างอัตโนมัติจาก/i)
assert.match(migration, /revoke execute on function public\.create_purchase_request\(uuid, jsonb, jsonb\) from public, anon, authenticated/i)
assert.doesNotMatch(migration, /security definer/i)

const picker = readFileSync(join(process.cwd(), 'components/pr/ContractItemPicker.tsx'), 'utf8')
assert.match(picker, /onAddManual/, 'the PR picker exposes a manual catalogue path')
assert.match(picker, /รหัสน้ำยา \(LS\)/)
assert.match(picker, /ชื่อน้ำยา/)
assert.match(picker, /ระบบจะสร้างรายการน้ำยาในคงคลังให้อัตโนมัติ/)

console.log('purchase request manual catalogue: ok')
