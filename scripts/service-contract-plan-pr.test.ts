import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const migration = read('supabase/migrations/20260904120000_service_contract_plan_pr_flow.sql')
const actions = read('lib/service-procurement/actions.ts')
const planPage = read('app/(protected)/service-procurement/plans/[id]/page.tsx')
const form = read('components/service-procurement/ServicePurchaseRequestForm.tsx')
const detail = read('app/(protected)/service-procurement/purchase-requests/[id]/page.tsx')

assert.match(migration, /Service-only contract-plan document flow/)
assert.match(migration, /Purchase \(inventory\) tables and RPCs are intentionally not changed here/)
assert.match(migration, /p_document_kind = 'contract_page' and p_mime_type <> 'application\/pdf'/)
assert.match(migration, /contract-backed service PR must not include TOR or quotation files/)
assert.match(migration, /contract-backed service PR requires a PDF contract on the selected plan/)
assert.match(migration, /create or replace function public\.service_procurement_plan_usage_date_allowed\(/, 'service PRs must expose the October carryover date policy')
assert.match(migration, /make_date\(p_plan_fiscal_year - 543, 10, 31\)/, 'service carryover must end on 31 October after the plan fiscal year')
assert.match(migration, /not public\.service_procurement_plan_usage_date_allowed\(row_plan\.fiscal_year, v_usage_start\)/, 'service create RPC must use the carryover date policy')
assert.match(migration, /not public\.service_procurement_plan_usage_date_allowed\(row_plan\.fiscal_year, v_usage_end\)/, 'service update RPC must use the carryover date policy')
assert.match(migration, /if row_plan\.requires_contract then/)
assert.match(migration, /if not row_plan\.requires_contract and not exists/)
assert.doesNotMatch(migration, /first service PR requires a newly attached contract page/)

assert.match(actions, /export async function uploadServicePlanContract/)
assert.match(actions, /assertServicePlanManager\(actor\)/)
assert.match(actions, /file\.type !== 'application\/pdf'/)
assert.match(actions, /if \(requiresContract && \(tor \|\| quotation\)\)/)
assert.match(actions, /ไฟล์สัญญาต้องแนบที่รายละเอียดแผนงานจ้าง/)
assert.doesNotMatch(actions, /if \(contractPage\) await upsertPlanDocument/)

assert.match(planPage, /ServicePlanContractUpload/)
assert.match(planPage, /plan\.requiresContract && canManage/)
assert.match(form, /plan\?\.requiresContract \?/)
assert.match(form, /สัญญาจากแผนงานจ้าง/)
assert.match(form, /ไม่ต้องแนบ TOR หรือใบเสนอราคาใน PR นี้/)
assert.doesNotMatch(form, /setContractPage/)
assert.doesNotMatch(form, /documentCard\('contractPage'/)
assert.doesNotMatch(form, /formData\.set\('contractPage'/)

assert.match(detail, /!request\.requiresContract \? request\.attachments\.map/)
assert.match(detail, /file\.kind === 'contract_page'/)
assert.match(detail, /สัญญา · จากแผนงานจ้าง/)

console.log('service contract plan PR flow: ok')
