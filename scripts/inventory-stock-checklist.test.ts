import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getStockCheckWeekStart } from '../lib/inventory/checklist'

const read = (path: string) => readFileSync(path, 'utf8')
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) => name.endsWith('_inventory_stock_checklist.sql'))
assert.equal(migrationNames.length, 1, 'the weekly stock-check migration must exist exactly once')

const migrationSql = read(join(migrationsDir, migrationNames[0]))

// Monday 00:00 in Bangkok is represented by the Bangkok business date. The
// helper deliberately does not depend on the machine's local timezone.
assert.equal(getStockCheckWeekStart('2026-08-23'), '2026-08-17', 'Sunday belongs to the preceding Monday week')
assert.equal(getStockCheckWeekStart('2026-08-24'), '2026-08-24', 'Monday starts a new week')
assert.equal(getStockCheckWeekStart('2026-08-25'), '2026-08-24', 'Tuesday stays in the Monday week')
assert.equal(getStockCheckWeekStart('2027-01-03'), '2026-12-28', 'year boundaries keep the Monday calculation intact')
assert.equal(getStockCheckWeekStart('2027-01-04'), '2027-01-04')

assert.match(migrationSql, /create table if not exists public\.inventory_stock_checks/i)
assert.match(migrationSql, /inventory_item_id uuid not null references public\.inventory_items\(id\)/i)
assert.match(migrationSql, /checked_at timestamptz not null default now\(\)/i)
assert.match(migrationSql, /week_start date not null/i)
assert.match(migrationSql, /checked_by uuid not null references public\.profiles\(id\)/i)
assert.match(migrationSql, /inventory_stock_checks_item_checked_at_idx/i)
assert.match(migrationSql, /distinct on \(check_event\.inventory_item_id\)/i)
assert.match(migrationSql, /create or replace view public\.inventory_item_latest_stock_checks/i)
assert.match(migrationSql, /before update or delete on public\.inventory_stock_checks/i)
assert.match(migrationSql, /prevent_append_only_mutation/i)
assert.match(migrationSql, /alter table public\.inventory_stock_checks enable row level security/i)
assert.match(migrationSql, /grant select on table public\.inventory_stock_checks to authenticated/i)
assert.match(migrationSql, /grant select, insert, update, delete on table public\.inventory_stock_checks to service_role/i)
assert.match(migrationSql, /revoke execute on function public\.record_inventory_stock_check\(uuid, uuid\) from authenticated/i)
assert.match(migrationSql, /grant execute on function public\.record_inventory_stock_check\(uuid, uuid\) to service_role/i)

const rpcStart = migrationSql.search(/create or replace function public\.record_inventory_stock_check/i)
const rpcEnd = migrationSql.indexOf('$function$;', rpcStart)
const rpc = rpcStart >= 0 && rpcEnd >= 0 ? migrationSql.slice(rpcStart, rpcEnd) : ''
assert.ok(rpc, 'the stock-check RPC must be defined')
assert.match(rpc, /security invoker/i)
assert.match(rpc, /set search_path = ''/i)
assert.match(rpc, /for update/i)
assert.match(rpc, /item\.is_active/i)
assert.match(rpc, /inventory item is inactive/i)
assert.match(rpc, /current_balance <= 0/i)
assert.match(rpc, /current_week_start := date_trunc\('week', public\.lab_stock_today\(\)::timestamp\)::date/i)
assert.match(rpc, /checked_at,[\s\S]*now\(\)/i)
assert.match(rpc, /checked_by[\s\S]*p_actor_id/i)

const queries = read('lib/inventory/queries.ts')
assert.match(queries, /inventory_item_latest_stock_checks/)
assert.match(queries, /getStockCheckWeekStart\(bangkokToday\(\)\)/)
assert.match(queries, /lastStockCheckedAt: stockCheck\.lastCheckedAt/)
assert.match(queries, /isStockCheckedThisWeek: stockCheck\.isCheckedThisWeek/)

const types = read('lib/inventory/types.ts')
assert.match(types, /lastStockCheckedAt: string \| null/)
assert.match(types, /isStockCheckedThisWeek: boolean/)
assert.match(types, /export interface InventoryStockCheckResult/)

const actions = read('lib/inventory/actions.ts')
assert.match(actions, /export async function recordInventoryStockCheck/)
assert.match(actions, /requireStockOperator\(\)/)
assert.match(actions, /supabaseAdmin\.rpc\('record_inventory_stock_check'/)
assert.match(actions, /revalidatePath\('\/inventory\/checklist'\)/)

const checklistPage = read('app/(protected)/inventory/checklist/page.tsx')
assert.match(checklistPage, /redirect\('\/access-denied'\)/)
assert.match(checklistPage, /canOperateStock\(actor\)/)
assert.match(checklistPage, /item\.isActive && item\.onHand > 0/)
assert.match(checklistPage, /getStockCheckWeekStart\(bangkokToday\(\)\)/)
assert.match(checklistPage, /InventoryChecklistTable/)

const checklistTable = read('components/inventory/InventoryChecklistTable.tsx')
assert.match(checklistTable, /recordInventoryStockCheck/)
assert.match(checklistTable, /aria-pressed=\{isChecked\}/)
assert.match(checklistTable, /router\.refresh\(\)/)
assert.match(checklistTable, /เปิด popup ปรับยอด/)
assert.match(checklistTable, /StockAdjustmentDialog/)
assert.match(checklistTable, /loadLotsOnOpen/)
assert.match(checklistTable, /ตรวจนับสต๊อกประจำสัปดาห์/)
assert.match(checklistTable, /ยังไม่ได้ตรวจสัปดาห์นี้/)
assert.match(checklistTable, /inventory-checklist-table--desktop/)
assert.match(checklistTable, /inventory-checklist-cards/)

const inventoryPage = read('app/(protected)/inventory/page.tsx')
assert.match(inventoryPage, /checklistHref/)
assert.match(inventoryPage, /href=\{checklistHref\}/)
assert.match(inventoryPage, /stockedItemCount/)

const detailPage = read('app/(protected)/inventory/[id]/page.tsx')
assert.match(detailPage, /formatThaiDateTime\(item\.lastStockCheckedAt\)/)
assert.match(detailPage, /item\.isStockCheckedThisWeek/)

const summaryDialog = read('components/inventory/InventoryItemSummaryDialog.tsx')
assert.match(summaryDialog, /formatThaiDateTime\(summary\.lastStockCheckedAt\)/)
assert.match(summaryDialog, /summary\.isStockCheckedThisWeek/)

const adjustmentDialog = read('components/inventory/StockAdjustmentDialog.tsx')
assert.match(adjustmentDialog, /defaultReason\?/) 
assert.match(adjustmentDialog, /loadLotsOnOpen\?/) 
assert.match(adjustmentDialog, /getInventoryItemSummary\(itemId\)/)
assert.match(adjustmentDialog, /onClosed\?\.\(\)/)

console.log('inventory stock checklist tests passed')
