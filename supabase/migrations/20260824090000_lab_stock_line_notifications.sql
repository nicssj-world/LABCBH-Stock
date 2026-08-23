begin;

-- A LINE notification is an external side effect, so keep every attempt and
-- the exact PR/PO snapshot that was used to build its message. The retry key
-- lets the server safely resume a request after a timeout without creating a
-- second LINE message.
create table if not exists public.purchase_request_line_notifications (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  sent_by uuid not null references public.profiles(id) on delete restrict,
  status text not null check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  retry_key uuid not null unique default gen_random_uuid(),
  target_group_id text not null check (nullif(btrim(target_group_id), '') is not null),
  document_url text not null check (document_url like 'https://%'),
  document_number text not null check (nullif(btrim(document_number), '') is not null),
  department text not null check (nullif(btrim(department), '') is not null),
  requester_name text,
  po_number text not null check (nullif(btrim(po_number), '') is not null),
  po_file_name text,
  po_file_checksum text,
  item_count integer not null check (item_count >= 0),
  total numeric(17,2) not null check (total >= 0),
  line_message_id text,
  http_status integer check (http_status is null or http_status between 100 and 599),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint purchase_request_line_notifications_terminal_check check (
    (status = 'pending' and completed_at is null)
    or (status <> 'pending' and completed_at is not null)
  )
);

create index if not exists purchase_request_line_notifications_request_idx
  on public.purchase_request_line_notifications (purchase_request_id, created_at desc);

create unique index if not exists purchase_request_line_notifications_pending_idx
  on public.purchase_request_line_notifications (purchase_request_id)
  where status = 'pending';

alter table public.purchase_request_line_notifications enable row level security;

revoke all on table public.purchase_request_line_notifications from public, anon, authenticated;
grant select, insert, update on table public.purchase_request_line_notifications to service_role;

create or replace function public.begin_purchase_request_line_notification(
  p_pr_id uuid,
  p_actor_id uuid,
  p_confirmed_attempt_id uuid,
  p_target_group_id text,
  p_document_url text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  existing_attempt public.purchase_request_line_notifications%rowtype;
  latest_attempt public.purchase_request_line_notifications%rowtype;
  created_attempt public.purchase_request_line_notifications%rowtype;
  requester_name text;
  item_count integer;
  request_total numeric(17,2);
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if nullif(btrim(coalesce(p_target_group_id, '')), '') is null then
    raise exception using errcode = '23514', message = 'LINE group is not configured';
  end if;

  if p_document_url is null or p_document_url !~ '^https://' then
    raise exception using errcode = '23514', message = 'LINE document URL must use HTTPS';
  end if;

  -- Lock before inspecting the existing attempts. This is the same pattern as
  -- every purchase-request mutation and prevents two officers from creating
  -- different retry keys for the same PR at the same time.
  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if nullif(btrim(coalesce(locked_request.po_number, '')), '') is null
     or nullif(btrim(coalesce(locked_request.po_file_path, '')), '') is null
     or locked_request.po_file_deleted_at is not null then
    raise exception using
      errcode = '55000',
      message = 'purchase request must have an active PO number and file';
  end if;

  select *
  into existing_attempt
  from public.purchase_request_line_notifications attempt
  where attempt.purchase_request_id = p_pr_id
    and attempt.status = 'pending'
  order by attempt.created_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'attemptId', existing_attempt.id,
      'retryKey', existing_attempt.retry_key,
      'targetGroupId', existing_attempt.target_group_id,
      'documentUrl', existing_attempt.document_url,
      'documentNumber', existing_attempt.document_number,
      'department', existing_attempt.department,
      'requesterName', existing_attempt.requester_name,
      'poNumber', existing_attempt.po_number,
      'poFileName', existing_attempt.po_file_name,
      'poFileChecksum', existing_attempt.po_file_checksum,
      'itemCount', existing_attempt.item_count,
      'total', existing_attempt.total
    );
  end if;

  select *
  into latest_attempt
  from public.purchase_request_line_notifications attempt
  where attempt.purchase_request_id = p_pr_id
  order by attempt.created_at desc
  limit 1
  for update;

  if found
     and p_confirmed_attempt_id is distinct from latest_attempt.id then
    raise exception using
      errcode = '55000',
      message = 'LINE notification resend requires confirmation';
  end if;

  -- An unknown result can be retried with the same key for 24 hours. LINE will
  -- answer 409 if the first request was already accepted, which is success for
  -- this attempt rather than a second message.
  if found
     and latest_attempt.status = 'unknown'
     and latest_attempt.created_at >= now() - interval '24 hours' then
    update public.purchase_request_line_notifications
    set status = 'pending',
        completed_at = null,
        error_message = null,
        http_status = null,
        line_message_id = null
    where id = latest_attempt.id
    returning * into existing_attempt;

    return jsonb_build_object(
      'attemptId', existing_attempt.id,
      'retryKey', existing_attempt.retry_key,
      'targetGroupId', existing_attempt.target_group_id,
      'documentUrl', existing_attempt.document_url,
      'documentNumber', existing_attempt.document_number,
      'department', existing_attempt.department,
      'requesterName', existing_attempt.requester_name,
      'poNumber', existing_attempt.po_number,
      'poFileName', existing_attempt.po_file_name,
      'poFileChecksum', existing_attempt.po_file_checksum,
      'itemCount', existing_attempt.item_count,
      'total', existing_attempt.total
    );
  end if;

  select coalesce(profile.name, locked_request.head_name)
  into requester_name
  from public.profiles profile
  where profile.id = locked_request.requester_id;
  requester_name := coalesce(requester_name, locked_request.head_name);

  select count(*)::integer, coalesce(sum(item.line_total), 0)::numeric(17,2)
  into item_count, request_total
  from public.purchase_request_items item
  where item.purchase_request_id = p_pr_id;

  insert into public.purchase_request_line_notifications (
    purchase_request_id,
    sent_by,
    status,
    target_group_id,
    document_url,
    document_number,
    department,
    requester_name,
    po_number,
    po_file_name,
    po_file_checksum,
    item_count,
    total
  )
  values (
    p_pr_id,
    p_actor_id,
    'pending',
    btrim(p_target_group_id),
    p_document_url,
    btrim(locked_request.document_number),
    btrim(locked_request.department),
    requester_name,
    btrim(locked_request.po_number),
    locked_request.po_file_name,
    locked_request.po_file_checksum,
    item_count,
    request_total
  )
  returning * into created_attempt;

  return jsonb_build_object(
    'attemptId', created_attempt.id,
    'retryKey', created_attempt.retry_key,
    'targetGroupId', created_attempt.target_group_id,
    'documentUrl', created_attempt.document_url,
    'documentNumber', created_attempt.document_number,
    'department', created_attempt.department,
    'requesterName', created_attempt.requester_name,
    'poNumber', created_attempt.po_number,
    'poFileName', created_attempt.po_file_name,
    'poFileChecksum', created_attempt.po_file_checksum,
    'itemCount', created_attempt.item_count,
    'total', created_attempt.total
  );
end
$function$;

revoke execute on function public.begin_purchase_request_line_notification(uuid, uuid, uuid, text, text) from public;
revoke execute on function public.begin_purchase_request_line_notification(uuid, uuid, uuid, text, text) from anon;
revoke execute on function public.begin_purchase_request_line_notification(uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.begin_purchase_request_line_notification(uuid, uuid, uuid, text, text) to service_role;

create or replace function public.complete_purchase_request_line_notification(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_status text,
  p_http_status integer,
  p_line_message_id text,
  p_error_message text
)
returns public.purchase_request_line_notifications
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_attempt public.purchase_request_line_notifications%rowtype;
  completed_attempt public.purchase_request_line_notifications%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if p_status not in ('succeeded', 'failed', 'unknown') then
    raise exception using errcode = '22023', message = 'invalid LINE notification completion status';
  end if;

  select *
  into locked_attempt
  from public.purchase_request_line_notifications attempt
  where attempt.id = p_attempt_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'LINE notification attempt not found';
  end if;

  if locked_attempt.sent_by <> p_actor_id then
    raise exception using errcode = '42501', message = 'LINE notification belongs to another actor';
  end if;

  if locked_attempt.status <> 'pending' then
    return locked_attempt;
  end if;

  update public.purchase_request_line_notifications
  set status = p_status,
      http_status = p_http_status,
      line_message_id = nullif(btrim(coalesce(p_line_message_id, '')), ''),
      error_message = nullif(left(btrim(coalesce(p_error_message, '')), 1000), ''),
      completed_at = now()
  where id = p_attempt_id
  returning * into completed_attempt;

  return completed_attempt;
end
$function$;

revoke execute on function public.complete_purchase_request_line_notification(uuid, uuid, text, integer, text, text) from public;
revoke execute on function public.complete_purchase_request_line_notification(uuid, uuid, text, integer, text, text) from anon;
revoke execute on function public.complete_purchase_request_line_notification(uuid, uuid, text, integer, text, text) from authenticated;
grant execute on function public.complete_purchase_request_line_notification(uuid, uuid, text, integer, text, text) to service_role;

commit;
