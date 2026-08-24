import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir).find((file) => file.endsWith('_requisition_stock_reservation.sql'))
assert.ok(migrationName, 'the stock reservation migration must exist')
const sql = readFileSync(join(migrationsDir, migrationName), 'utf8')

const fn = (name: string) => {
  const body = sql.match(
    new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$function\\$;`, 'i'),
  )?.[0]
  assert.ok(body, `${name} must be redefined in the reservation migration`)
  return body
}

// Waiting requisitions are the reservation ledger. A separate reservation row
// would duplicate the lifecycle state that already exists on requisitions and
// would need a second release path on edit/cancel.
assert.match(sql, /create or replace view public\.inventory_item_requisition_availability/i)
assert.match(sql, /with \(security_invoker\s*=\s*true\)/i)
assert.match(sql, /usable_on_hand/i)
assert.match(sql, /waiting_reserved/i)
assert.match(sql, /available_to_request/i)
assert.match(sql, /requisition\.status\s*=\s*'waiting'/i)
assert.match(sql, /public\.lab_stock_today\(\)/i)
assert.match(sql, /grant select on public\.inventory_item_requisition_availability to authenticated/i)

const availabilityGuard = fn('assert_requisition_stock_available')
assert.match(availabilityGuard, /for update/i, 'availability must be checked after locking inventory items')
assert.match(availabilityGuard, /order by (catalogue|item)\.id/i, 'inventory item locks must be deterministic')
assert.match(availabilityGuard, /waiting_reserved/i)
assert.match(availabilityGuard, /p_exclude_requisition_id/i)
assert.match(availabilityGuard, /available/i)
assert.match(availabilityGuard, /cannot request|เบิกได้อีก|insufficient/i)

const create = fn('create_requisition')
assert.match(create, /perform public\.assert_requisition_stock_available/i)
assert.ok(
  create.indexOf('assert_requisition_stock_available') < create.indexOf('insert into public.requisitions'),
  'creation must reserve/check before inserting the waiting requisition',
)
assert.doesNotMatch(create, /insert into public\.stock_movements/i, 'reservation must not deduct the ledger')

const update = fn('update_requisition')
assert.match(update, /perform public\.assert_requisition_stock_available/i)
assert.match(update, /p_requisition_id|locked_requisition\.id/i)
assert.match(update, /delete from public\.requisition_items/i)

const cancel = fn('cancel_requisition')
assert.match(cancel, /status\s*=\s*'cancelled'/i)
assert.match(cancel, /for update/i)
assert.match(cancel, /inventory_items/i, 'cancellation must serialize with new reservations')

const fulfil = fn('fulfill_requisition')
assert.match(fulfil, /from public\.inventory_items[\s\S]*?for update/i)
assert.match(fulfil, /insert into public\.stock_movements/i)
assert.match(fulfil, /'requisition_issue'/i)
assert.match(fulfil, /public\.lab_stock_today\(\)/i)

for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.assert_requisition_stock_available\\(uuid\\[\\], jsonb, uuid\\) from ${role}`, 'i'),
  )
}
assert.match(sql, /grant execute on function public\.assert_requisition_stock_available\(uuid\[\], jsonb, uuid\) to service_role/i)

console.log('requisition stock reservation: ok (static contract)')
