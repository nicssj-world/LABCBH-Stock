import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync('supabase/migrations/20260826100000_service_procurement.sql', 'utf8')
const rpc = readFileSync('supabase/migrations/20260826101000_service_procurement_rpc.sql', 'utf8')
const cleanup = readFileSync('supabase/migrations/20260826102000_service_procurement_cleanup.sql', 'utf8')

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
assert.match(rpc, /drop table if exists public\.out_lab_contracts cascade/i)
assert.match(rpc, /drop function if exists public\.create_out_lab_contract/i)
assert.doesNotMatch(rpc, /grant select, insert, update, delete on all tables in schema public/i)
assert.doesNotMatch(`${schema}\n${rpc}`, /security definer/i)
assert.match(cleanup, /delete from public\.storage_cleanup_jobs[\s\S]*storage_key like 'out-lab\/%'/i)
assert.match(cleanup, /storage_key like 'service-procurement\/%'/i)
assert.doesNotMatch(cleanup, /or storage_key like 'out-lab\/%'/i)

console.log('service procurement schema: ok')
