import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const migration = read('supabase/migrations/20260820030000_lab_stock_notifications.sql')
const queries = read('lib/notifications/queries.ts')
const actions = read('lib/notifications/actions.ts')
const center = read('components/notifications/NotificationCenter.tsx')
const shell = read('components/ui/AppShell.tsx')
const layout = read('app/(protected)/layout.tsx')
const styles = read('app/globals.css')

assert.match(migration, /create table if not exists public\.lab_stock_notifications/)
assert.match(migration, /unique \(recipient_id, event_type, entity_id\)/)
assert.match(migration, /create policy lab_stock_notifications_recipient_read/)
assert.match(migration, /using \(recipient_id = \(select auth\.uid\(\)\)\)/)
assert.match(migration, /create or replace function public\.enqueue_purchase_request_notification/)
assert.match(migration, /new\.status = 'pending'/)
assert.match(migration, /create or replace function public\.enqueue_requisition_notification/)
assert.match(migration, /new\.status = 'waiting'/)
assert.match(migration, /membership\.role in \('admin', 'stock_officer'\)/)
assert.match(migration, /profile\.ephis_id = '9495'/)
assert.match(migration, /create trigger purchase_requests_enqueue_notification/)
assert.match(migration, /create trigger requisitions_enqueue_notification/)
assert.match(migration, /after insert or update of status on public\.purchase_requests/)
assert.match(migration, /after insert or update of status on public\.requisitions/)
assert.match(migration, /create trigger purchase_requests_resolve_notification/)
assert.match(migration, /create trigger requisitions_resolve_notification/)
assert.match(migration, /alter publication supabase_realtime add table public\.lab_stock_notifications/)
assert.doesNotMatch(migration, /security definer/i, 'notification triggers must not expose a public security-definer function')

assert.match(queries, /canOperateStock\(actor\)/)
assert.match(queries, /\.eq\('status', 'pending'\)/)
assert.match(queries, /\.eq\('status', 'waiting'\)/)
assert.match(queries, /\.eq\('recipient_id', actor\.id\)/)
assert.match(queries, /\.is\('read_at', null\)/)
// Marking read is a write, so it goes through an RPC like every other write —
// see 20260820043000_lab_stock_notification_read_rpc.sql. supabaseAdmin is the
// service role and bypasses RLS, so the recipient check has to be enforced in
// the database; a .update() chain here would put it back in TypeScript, where
// nothing at the database level notices if it is ever dropped.
assert.match(actions, /supabaseAdmin\.rpc\('mark_lab_stock_notification_read'/)
assert.match(actions, /supabaseAdmin\.rpc\('mark_all_lab_stock_notifications_read'/)
assert.match(actions, /p_actor_id: actor\.id/)
assert.doesNotMatch(
  actions,
  /\.from\('lab_stock_notifications'\)[\s\S]*?\.update\(/,
  'notification writes must not go back to updating the table directly',
)

const readRpc = read('supabase/migrations/20260820043000_lab_stock_notification_read_rpc.sql')
assert.match(readRpc, /create or replace function public\.mark_lab_stock_notification_read/)
assert.match(readRpc, /create or replace function public\.mark_all_lab_stock_notifications_read/)
// The recipient predicate is the reason these functions exist.
assert.match(
  readRpc,
  /where id = p_notification_id\s*\n\s*and recipient_id = p_actor_id\s*\n\s*and read_at is null/,
  'a single mark-read must be scoped to the actor\'s own notification',
)
assert.match(
  readRpc,
  /where recipient_id = p_actor_id\s*\n\s*and read_at is null/,
  'mark-all must be scoped to the actor\'s own notifications',
)
assert.match(readRpc, /perform public\.assert_stock_officer_actor\(p_actor_id\)/)
assert.doesNotMatch(readRpc, /security definer/i, 'these run as the calling service role, not as their owner')
for (const name of ['mark_lab_stock_notification_read\\(uuid, uuid\\)', 'mark_all_lab_stock_notifications_read\\(uuid\\)']) {
  assert.match(readRpc, new RegExp(`revoke execute on function public\\.${name} from authenticated`))
  assert.match(readRpc, new RegExp(`grant execute on function public\\.${name} to service_role`))
}
// With the RPCs as the only write path, the browser's direct UPDATE grant is a
// second one nothing uses. Realtime authorises Postgres Changes through the
// SELECT policy, which is deliberately left alone.
assert.match(readRpc, /drop policy if exists lab_stock_notifications_recipient_update/)
assert.match(readRpc, /revoke update on table public\.lab_stock_notifications from authenticated/)
assert.doesNotMatch(
  readRpc,
  /drop policy if exists lab_stock_notifications_recipient_read/,
  'the read policy carries the realtime subscription and must survive',
)

assert.match(layout, /getNotificationSnapshot\(actor\)/)
assert.match(shell, /<NotificationCenter/)
assert.match(shell, /pendingPurchaseRequests/)
assert.match(shell, /waitingRequisitions/)
assert.match(center, /postgres_changes/)
assert.match(center, /event: 'INSERT'/)
assert.match(center, /event: 'UPDATE'/)
assert.match(center, /aria-live="polite"/)
assert.match(center, /markAllNotificationsRead/)
assert.match(styles, /\.bench-nav__count\s*\{/)
assert.match(styles, /\.notification-center__panel\s*\{/)
assert.match(styles, /\.notification-center__toast\s*\{/)

console.log('stock notification contract: ok')
