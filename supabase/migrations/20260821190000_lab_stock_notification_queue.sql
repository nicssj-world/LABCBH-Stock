-- Keep notification history, but separate it from the active notification
-- queue. Resolving an underlying work item hides its notification through
-- resolved_at; "mark all as read" hides the remaining active queue through
-- dismissed_at without deleting the audit trail.
begin;

alter table public.lab_stock_notifications
  add column if not exists dismissed_at timestamptz;

-- Reconcile notifications created before the queue filter was deployed. This
-- keeps an already-resolved PR or requisition out of the active list even if
-- its original status update did not pass through the notification trigger.
update public.lab_stock_notifications notification
set resolved_at = coalesce(notification.resolved_at, now())
from public.purchase_requests request
where notification.entity_type = 'purchase_request'
  and notification.entity_id = request.id
  and request.status <> 'pending'
  and notification.resolved_at is null;

update public.lab_stock_notifications notification
set resolved_at = coalesce(notification.resolved_at, now())
from public.requisitions requisition
where notification.entity_type = 'requisition'
  and notification.entity_id = requisition.id
  and requisition.status <> 'waiting'
  and notification.resolved_at is null;

create index if not exists lab_stock_notifications_recipient_active_idx
  on public.lab_stock_notifications (recipient_id, created_at desc)
  where resolved_at is null and dismissed_at is null;

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
  set read_at = coalesce(read_at, now()),
      dismissed_at = coalesce(dismissed_at, now())
  where recipient_id = p_actor_id
    and resolved_at is null
    and dismissed_at is null;

  get diagnostics affected = row_count;
  return affected;
end
$function$;

revoke execute on function public.mark_all_lab_stock_notifications_read(uuid) from public;
revoke execute on function public.mark_all_lab_stock_notifications_read(uuid) from anon;
revoke execute on function public.mark_all_lab_stock_notifications_read(uuid) from authenticated;
grant execute on function public.mark_all_lab_stock_notifications_read(uuid) to service_role;

commit;
