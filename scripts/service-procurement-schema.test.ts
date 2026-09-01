import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync('supabase/migrations/20260826100000_service_procurement.sql', 'utf8')
const rpc = readFileSync('supabase/migrations/20260826101000_service_procurement_rpc.sql', 'utf8')
const cleanup = readFileSync('supabase/migrations/20260826102000_service_procurement_cleanup.sql', 'utf8')
const expenseNote = readFileSync('supabase/migrations/20260827110000_service_plan_expense_note.sql', 'utf8')
const productionRepair = readFileSync('supabase/migrations/20260827044504_purchase_request_service_line_ambiguity.sql', 'utf8')
const serviceWorkflow = readFileSync('supabase/migrations/20260828170000_service_procurement_workflow.sql', 'utf8')
const serviceContractAutoClose = readFileSync('supabase/migrations/20260830010000_service_purchase_request_contract_auto_close.sql', 'utf8')
const serviceUntaggedAutoClose = readFileSync('supabase/migrations/20260830020000_service_purchase_request_untagged_auto_close.sql', 'utf8')
const serviceDateRange = readFileSync('supabase/migrations/20260830000000_service_purchase_request_date_range.sql', 'utf8')
const serviceCreditNotes = readFileSync('supabase/migrations/20260901103827_service_purchase_request_credit_notes.sql', 'utf8')
const serviceActions = readFileSync('lib/service-procurement/actions.ts', 'utf8')

for (const table of [
  'service_procurement_plans',
  'service_plan_responsibles',
  'service_plan_responsible_audit',
  'service_plan_budget_revisions',
  'service_purchase_requests',
  'service_purchase_request_items',
  'service_purchase_request_usage_events',
  'service_purchase_request_usage_items',
  'service_plan_ledger',
  'service_purchase_request_attachments',
  'service_purchase_request_committees',
  'service_purchase_request_po_events',
  'service_purchase_request_line_notifications',
]) {
  assert.match(`${schema}\n${rpc}`, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `${table} must be created`)
  assert.match(rpc, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} must enable RLS`)
}

for (const fn of [
  'service_procurement_actor_has_role',
  'service_procurement_assert_actor',
  'service_procurement_fiscal_year',
  'service_procurement_plan_balance',
  'create_service_procurement_plan',
  'update_service_procurement_plan',
  'set_service_plan_responsibles',
  'revise_service_plan_budget',
  'delete_service_procurement_plan',
  'record_service_plan_historical_expense',
  'adjust_service_plan_expense',
  'create_service_purchase_request',
  'record_service_purchase_request_usage',
  'record_service_purchase_request_lab_expense',
  'adjust_service_purchase_request_lab_expense',
  'close_service_purchase_request_po',
  'cancel_service_purchase_request_po',
  'begin_service_purchase_request_line_notification',
  'complete_service_purchase_request_line_notification',
]) {
  assert.match(rpc, new RegExp(`create or replace function public\\.${fn}\\(`, 'i'), `${fn} must be an RPC`)
  assert.match(rpc, new RegExp(`revoke execute on function public\\.${fn}[\\s\\S]*?from public, anon, authenticated`, 'i'), `${fn} must be private`)
  assert.match(rpc, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to service_role`, 'i'), `${fn} must be service-role only`)
}

assert.match(rpc, /pg_advisory_xact_lock\(hashtext\('labcbh_service_purchase_request_sequence'/)
assert.match(schema, /reference_event_id uuid references public\.service_purchase_request_usage_events/i)
assert.match(schema, /reference_ledger_id uuid references public\.service_plan_ledger/i)
assert.match(rpc, /expense_reversal[\s\S]*reference_event_id/i)
assert.match(rpc, /expense_reversal[\s\S]*reference_ledger_id/i)
assert.match(productionRepair, /create_service_purchase_request\(uuid, jsonb\)/i, 'Production repair targets the service PR RPC')
assert.match(productionRepair, /line_payload/i, 'Production repair separates the PL/pgSQL line variable')
assert.match(productionRepair, /item_payload/i, 'Production repair separates the JSON array alias')
assert.match(rpc, /drop table if exists public\.out_lab_contracts cascade/i)
assert.match(rpc, /drop function if exists public\.create_out_lab_contract/i)
assert.doesNotMatch(rpc, /grant select, insert, update, delete on all tables in schema public/i)
assert.doesNotMatch(`${schema}\n${rpc}`, /security definer/i)
assert.match(cleanup, /delete from public\.storage_cleanup_jobs[\s\S]*storage_key like 'out-lab\/%'/i)
assert.match(cleanup, /storage_key like 'service-procurement\/%'/i)
assert.doesNotMatch(cleanup, /or storage_key like 'out-lab\/%'/i)
assert.match(expenseNote, /alter column reason drop not null/i, 'expense notes must be optional')
assert.match(expenseNote, /requires a source reference/i, 'PR/PO reference must remain required')
assert.doesNotMatch(expenseNote, /requires a reason and source reference/i, 'expense notes must not be required')
assert.match(serviceWorkflow, /create unique index if not exists service_purchase_request_expenses_invoice_unique[\s\S]*lower\(btrim\(invoice_number\)\)[\s\S]*status = 'active'/i, 'active service expenses must enforce unique Invoice numbers per PR')
assert.match(serviceCreditNotes, /add column if not exists document_kind text not null default 'invoice'/i, 'expense rows must persist the document type')
assert.match(serviceCreditNotes, /add column if not exists source_expense_id uuid/i, 'credit notes must point to their source invoice')
assert.match(serviceCreditNotes, /document_kind = 'credit_note'[\s\S]*source_expense_id is not null/i, 'credit notes must require a source expense')
assert.match(serviceCreditNotes, /source_expense_id <> id/i, 'credit notes must not reference themselves')
assert.match(serviceCreditNotes, /sum\(case when expense\.document_kind = 'credit_note' then -expense\.amount else expense\.amount end\)/i, 'closing a PO must post net expense')
assert.match(serviceCreditNotes, /credit note exceeds remaining source invoice amount/i, 'credit notes must be capped at the source invoice balance')
assert.match(serviceCreditNotes, /drop function if exists public\.record_service_purchase_request_expense\(uuid, uuid, date, numeric, text, text\)/i, 'the old expense RPC signature must be replaced')
assert.match(serviceCreditNotes, /p_document_kind text default 'invoice'/i, 'the expense RPC must accept document kind')
assert.match(serviceCreditNotes, /p_source_expense_id uuid default null/i, 'the expense RPC must accept a source expense')
assert.match(serviceCreditNotes, /revoke execute on function public\.record_service_purchase_request_expense\(uuid, uuid, date, numeric, text, text, text, uuid\)[\s\S]*from public, anon, authenticated/i, 'the credit-note RPC must remain private')
assert.match(serviceCreditNotes, /grant execute on function public\.record_service_purchase_request_expense\(uuid, uuid, date, numeric, text, text, text, uuid\)[\s\S]*to service_role/i, 'the credit-note RPC must remain service-role only')
assert.match(serviceCreditNotes, /source\.purchase_request_id = request_row\.id[\s\S]*source_row\.document_kind [<>!=]+ 'invoice'/i, 'a credit note source must be an invoice in the same PR')
assert.match(serviceCreditNotes, /perform 1 from public\.service_purchase_request_expenses expense where expense\.purchase_request_id = request_row\.id for update/i, 'expense mutations must lock all rows for credit-note concurrency')
assert.doesNotMatch(serviceCreditNotes, /security definer/i, 'credit-note RPCs must not bypass RLS with SECURITY DEFINER')
assert.match(serviceContractAutoClose, /create or replace function public\.record_service_purchase_request_expense\(/i, 'contract workflow must override the expense RPC')
assert.match(serviceContractAutoClose, /if\s+plan_row\.requires_contract[\s\S]*perform\s+public\.close_service_purchase_request_po\(\s*p_actor_id\s*,\s*p_request_id/i, 'contract-backed service expenses must close the PO after recording')
assert.match(serviceContractAutoClose, /service_purchase_request_expense_audits[\s\S]*if\s+plan_row\.requires_contract/i, 'contract PO closure must happen after the expense audit is recorded')
assert.doesNotMatch(serviceContractAutoClose, /plan_row\.requires_contract\s+and\s+plan_row\.is_red_cross/i, 'contract PO closure must also apply to plans without the Red Cross tag')
assert.match(serviceUntaggedAutoClose, /create or replace function public\.record_service_purchase_request_expense\(/i, 'untagged plans must use the expense RPC override')
assert.match(serviceUntaggedAutoClose, /if\s+\(\s*plan_row\.requires_contract\s+or\s+not\s+plan_row\.is_red_cross\s*\)\s+then/i, 'untagged service plans must use the same automatic PO closure workflow')
assert.match(serviceUntaggedAutoClose, /service_purchase_request_expense_audits[\s\S]*if\s+\(\s*plan_row\.requires_contract\s+or\s+not\s+plan_row\.is_red_cross/i, 'untagged PO closure must happen after the expense audit is recorded')
assert.match(serviceActions, /recordServiceLabExpense[\s\S]*revalidateRequest\(parsed\.requestId\)[\s\S]*revalidatePlan\(\)/i, 'recording a service expense must refresh plan balances')
assert.match(serviceDateRange, /usage_start_date\s*<\s*usage_end_date/i, 'service PO usage dates must be strictly ordered')
assert.match(serviceDateRange, /not valid/i, 'strict service PO date validation must preserve historical equal-date rows')
assert.match(serviceActions, /const \{ committees: rawCommittees, \.\.\.draftWithoutCommittees \} = draft/, 'service PR action must remove top-level committees before strict schema parsing')
assert.match(serviceActions, /servicePurchaseRequestInputSchema\.parse\(\{[\s\S]*\.\.\.draftWithoutCommittees/, 'service PR schema parsing must use the payload without the transport-only committees key')

console.log('service procurement schema: ok')
