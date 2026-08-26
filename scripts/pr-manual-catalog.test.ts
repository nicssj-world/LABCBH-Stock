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

const manualPicker = picker.match(/<fieldset className="item-picker__manual">[\s\S]*?<\/fieldset>/)?.[0]
assert.ok(manualPicker, 'the manual catalogue section must remain present')
assert.doesNotMatch(manualPicker, /field-required|\brequired\b/, 'the optional manual catalogue section must not block PR submission')

// A follow-up migration closed three gaps left by the one above — see its own
// header comment for the full reasoning. Asserted separately, by its own
// distinct suffix, so it stays covered even though it doesn't share the
// original migration's filename.
const fixName = readdirSync(migrationsDir).find((name) => name.endsWith('_pr_manual_catalog_items_fixes.sql'))
assert.ok(fixName, 'the PR manual catalogue follow-up fix migration must exist')
const fix = readFileSync(join(migrationsDir, fixName!), 'utf8')

assert.match(fix, /create or replace function public\.create_purchase_request/i)

// Fix 1: a contract-linked line's unit must come from the contract, exactly
// like unit_price already does — never from client input, since it becomes
// contract_item_allocations.quantity verbatim at confirmation.
assert.match(
  fix,
  /select contract_item\.unit_price, contract_item\.contract_id, contract_item\.ls_code, contract_item\.unit\s*\n\s*into resolved_unit_price, resolved_contract_id, resolved_contract_ls_code, resolved_unit/i,
  'a contract-linked line must resolve its unit from contract_items, not from client input',
)
assert.match(
  fix,
  /resolved_requested_quantity,\s*\n\s*resolved_unit,\s*\n\s*resolved_unit_price/,
  'the final insert must use the resolved (server-trusted) unit, not the raw line payload',
)
assert.doesNotMatch(
  fix,
  /values \(\s*\n\s*created_request\.id,[\s\S]*?btrim\(line ->> 'unit'\)/,
  'the item insert must never fall back to trusting the client-submitted unit directly',
)

// Fix 2: an inactive item sharing the normalized LS code must be named as the
// cause, not folded into the generic "could not resolve" message — the
// unique index isn't partial, so ON CONFLICT DO NOTHING already caught it.
assert.match(fix, /resolved_item_is_active/i)
assert.match(
  fix,
  /if not resolved_item_is_active then/i,
  'an inactive duplicate must be distinguished from "no such item at all"',
)
assert.match(fix, /already uses this LS code; reactivate it/i)

// Fix 3: numeric line fields and the request's own required fields must fail
// with this function's own clean errors, not a raw constraint/cast error.
assert.match(fix, /fiscal year is required/i)
assert.match(fix, /department is required/i)
assert.match(fix, /requester head name is required/i)
assert.match(fix, /requested date is required/i)
assert.match(
  fix,
  /requested quantity greater than zero/i,
  'requestedQuantity must be validated for every line, contract-linked or manual',
)
assert.match(fix, /unit price of zero or more/i)
assert.match(
  fix,
  /when invalid_text_representation or numeric_value_out_of_range then/i,
  'a non-numeric unitPrice/requestedQuantity must be caught before it reaches a bare cast',
)

// The revoke/grant boundary and invoker-rights posture must survive the
// rewrite unchanged — this function still runs as the calling actor, not a
// privileged definer.
assert.match(fix, /revoke execute on function public\.create_purchase_request\(uuid, jsonb, jsonb\) from public, anon, authenticated/i)
assert.doesNotMatch(fix, /security definer/i)

// Fix 3 shipped its own bug: `p_request ->> 'fiscalYear' !~ pattern` is null,
// not true, when the key is entirely absent — SQL's three-valued logic makes
// `if null then` silently false, so an omitted fiscalYear skipped the check
// and fell through to a raw not-null violation later. Caught by running the
// fix against real staging data, not by reading the SQL. contractId already
// got this right a few lines below with coalesce(..., ''); this closes the
// same gap for fiscalYear.
const fiscalYearFixName = readdirSync(migrationsDir).find((name) => name.endsWith('_pr_manual_catalog_items_fiscal_year_null.sql'))
assert.ok(fiscalYearFixName, 'the fiscalYear null-check follow-up migration must exist')
const fiscalYearFix = readFileSync(join(migrationsDir, fiscalYearFixName!), 'utf8')
assert.match(
  fiscalYearFix,
  /if coalesce\(p_request ->> 'fiscalYear', ''\) !~ '\^\[0-9\]\+\$' then/,
  'fiscalYear must be coalesced before the regex check, or an omitted key silently passes',
)
assert.doesNotMatch(
  fiscalYearFix,
  /if p_request ->> 'fiscalYear' !~/,
  'the uncoalesced (buggy) form must not still be present',
)

console.log('purchase request manual catalogue: ok')
