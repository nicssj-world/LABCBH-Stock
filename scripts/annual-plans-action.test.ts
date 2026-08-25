import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const actions = read('lib/annual-plans/actions.ts')
const cleanup = read('lib/annual-plans/cleanup.ts')
const route = read('app/api/annual-plans/upload/route.ts')
const cleanupMigration = read('supabase/migrations/20260825182000_annual_plan_cleanup_retry.sql')

assert.match(actions, /requireActor/)
assert.match(actions, /validateAnnualPlanFile/)
assert.match(actions, /supabaseAdmin\.storage/)
assert.match(actions, /upsert_lab_stock_annual_plan/)
assert.match(actions, /createSignedUrl/)
assert.match(cleanup, /hard_delete_lab_stock_annual_plan/)
assert.match(cleanup, /enqueueStorageCleanupJobBestEffort/)
assert.match(route, /storeAnnualPlan/)
assert.match(route, /FormData/)
assert.match(cleanupMigration, /annual_plan_retention_retry/i)
assert.match(cleanupMigration, /lab-stock-annual-plans/i)
assert.match(cleanupMigration, /create or replace function public\.enqueue_storage_cleanup_job/i)

console.log('annual plan actions: ok')
