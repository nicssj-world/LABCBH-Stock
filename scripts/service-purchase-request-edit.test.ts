import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const routePath = 'app/(protected)/service-procurement/purchase-requests/[id]/edit/page.tsx'
const route = read(routePath)
const form = read('components/service-procurement/ServicePurchaseRequestForm.tsx')
const actions = read('lib/service-procurement/actions.ts')
const migrationPath = 'supabase/migrations/20260829150000_service_purchase_request_edit.sql'
const migration = read(migrationPath)

assert.equal(existsSync(routePath), true, 'service PR edit route must exist')
assert.match(route, /ServicePurchaseRequestForm/)
assert.match(route, /mode="edit"/)
assert.match(route, /initialValues/)
assert.match(route, /canCreateServicePurchaseRequest/)
assert.match(route, /request\.status !== 'pending'/)

assert.match(form, /mode\??:/)
assert.match(form, /initialValues\??:/)
assert.match(form, /updateServicePurchaseRequest/)
assert.match(form, /บันทึกการแก้ไข/)
assert.match(form, /existingTor|torExisting/)

assert.match(actions, /export async function updateServicePurchaseRequest\(/)
assert.match(actions, /update_service_purchase_request/)
assert.match(actions, /readOptionalFile\(formData, 'tor'\)/)

assert.match(migration, /create or replace function public\.update_service_purchase_request\(/i)
assert.match(migration, /only pending service requests can be edited/i)
assert.match(migration, /service_purchase_request_test_item_snapshots/i)
assert.match(migration, /reservation_release/i)
assert.match(migration, /balance_row\.available \+ existing_reservation/i)
assert.match(migration, /insert into public\.service_plan_ledger/i)
assert.match(migration, /committee roster/i)

console.log('service purchase request edit: ok')
