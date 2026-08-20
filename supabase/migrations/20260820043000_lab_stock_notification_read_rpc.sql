-- Marking a notification read is a write, so it belongs in an RPC like every
-- other write in this application.
--
-- 20260820030000_lab_stock_notifications.sql created the table, and
-- lib/notifications/actions.ts updated read_at with a direct .update() call
-- through supabaseAdmin. That call is correct today — it filters on
-- recipient_id = actor.id — but supabaseAdmin is the service role, so RLS is
-- bypassed and that filter in TypeScript was the only thing standing between
-- one actor and another actor's rows. Nothing at the database level would
-- notice if a later refactor dropped it.
--
-- These two functions move the recipient check into the database, where it
-- holds no matter who calls or how. Semantics are deliberately identical to
-- the code they replace: filtering, not raising, so re-marking an already-read
-- notification stays a silent no-op rather than becoming an error the UI would
-- have to learn to swallow. The affected count is returned so a caller can
-- still tell the difference when it matters.
begin;

create or replace function public.mark_lab_stock_notification_read(
  p_actor_id uuid,
  p_notification_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  affected integer;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  -- recipient_id = p_actor_id is the whole point of this function: it is what
  -- stops one actor clearing another's queue, and it cannot be omitted by a
  -- caller the way an application-side filter can.
  update public.lab_stock_notifications
  set read_at = now()
  where id = p_notification_id
    and recipient_id = p_actor_id
    and read_at is null;

  get diagnostics affected = row_count;
  return affected;
end
$function$;

revoke execute on function public.mark_lab_stock_notification_read(uuid, uuid) from public;
revoke execute on function public.mark_lab_stock_notification_read(uuid, uuid) from anon;
revoke execute on function public.mark_lab_stock_notification_read(uuid, uuid) from authenticated;
grant execute on function public.mark_lab_stock_notification_read(uuid, uuid) to service_role;

create or replace function public.mark_all_lab_stock_notifications_read(
  p_actor_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  affected integer;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  update public.lab_stock_notifications
  set read_at = now()
  where recipient_id = p_actor_id
    and read_at is null;

  get diagnostics affected = row_count;
  return affected;
end
$function$;

revoke execute on function public.mark_all_lab_stock_notifications_read(uuid) from public;
revoke execute on function public.mark_all_lab_stock_notifications_read(uuid) from anon;
revoke execute on function public.mark_all_lab_stock_notifications_read(uuid) from authenticated;
grant execute on function public.mark_all_lab_stock_notifications_read(uuid) to service_role;

-- With the RPCs above as the only sanctioned write path, the direct UPDATE
-- grant to authenticated is a second one nothing uses: the browser never
-- writes this table, it only subscribes. Realtime authorises Postgres Changes
-- through the SELECT policy, so dropping the UPDATE grant and policy leaves
-- the live notification feed working exactly as before.
--
-- The SELECT grant and policy below are deliberately left in place — the
-- NotificationCenter's realtime subscription depends on them.
drop policy if exists lab_stock_notifications_recipient_update on public.lab_stock_notifications;
revoke update on table public.lab_stock_notifications from authenticated;

commit;
