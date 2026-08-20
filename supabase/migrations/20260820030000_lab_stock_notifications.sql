-- LABCBH Stock — durable in-app notifications for the stock work queue.
--
-- Notifications are created by the same database transaction that creates a
-- pending PR or waiting requisition. Read state belongs to each recipient;
-- resolution belongs to the underlying work item and never deletes history.

begin;

create table if not exists public.lab_stock_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'purchase_request_created',
    'requisition_created'
  )),
  entity_type text not null check (entity_type in ('purchase_request', 'requisition')),
  entity_id uuid not null,
  document_number text not null check (nullif(btrim(document_number), '') is not null),
  title text not null check (nullif(btrim(title), '') is not null),
  body text not null check (nullif(btrim(body), '') is not null),
  href text not null check (href like '/%'),
  read_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, event_type, entity_id)
);

create index if not exists lab_stock_notifications_recipient_created_idx
  on public.lab_stock_notifications (recipient_id, created_at desc);
create index if not exists lab_stock_notifications_recipient_unread_idx
  on public.lab_stock_notifications (recipient_id, read_at, created_at desc);
create index if not exists lab_stock_notifications_recipient_open_idx
  on public.lab_stock_notifications (recipient_id, resolved_at, created_at desc);
create index if not exists lab_stock_notifications_entity_idx
  on public.lab_stock_notifications (entity_type, entity_id);

alter table public.lab_stock_notifications enable row level security;
alter table public.lab_stock_notifications replica identity full;

revoke all on table public.lab_stock_notifications from anon, authenticated;
grant select on table public.lab_stock_notifications to authenticated;
grant update (read_at) on table public.lab_stock_notifications to authenticated;
grant select, insert, update, delete on table public.lab_stock_notifications to service_role;

drop policy if exists lab_stock_notifications_recipient_read on public.lab_stock_notifications;
create policy lab_stock_notifications_recipient_read
on public.lab_stock_notifications for select
to authenticated
using (recipient_id = (select auth.uid()));

drop policy if exists lab_stock_notifications_recipient_update on public.lab_stock_notifications;
create policy lab_stock_notifications_recipient_update
on public.lab_stock_notifications for update
to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

create or replace function public.enqueue_purchase_request_notification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'pending' then
    if tg_op = 'UPDATE' then
      if old.status = 'pending' then
        return new;
      end if;
    end if;

    insert into public.lab_stock_notifications (
      recipient_id,
      event_type,
      entity_type,
      entity_id,
      document_number,
      title,
      body,
      href
    )
    select distinct
      profile.id,
      'purchase_request_created',
      'purchase_request',
      new.id,
      new.document_number,
      'มี PR ใหม่รอดำเนินการ',
      format('หน่วยงาน %s · ผู้จัดทำ %s', new.department, new.head_name),
      '/purchase-requests/' || new.id::text
    from public.profiles profile
    left join public.lab_stock_memberships membership
      on membership.profile_id = profile.id
      and membership.active
    where profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.ephis_id = '9495'
        or membership.role in ('admin', 'stock_officer')
      )
    on conflict (recipient_id, event_type, entity_id) do nothing;
  end if;

  return new;
end
$function$;

revoke execute on function public.enqueue_purchase_request_notification() from public;
revoke execute on function public.enqueue_purchase_request_notification() from anon;
revoke execute on function public.enqueue_purchase_request_notification() from authenticated;

create or replace function public.enqueue_requisition_notification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'waiting' then
    if tg_op = 'UPDATE' then
      if old.status = 'waiting' then
        return new;
      end if;
    end if;

    insert into public.lab_stock_notifications (
      recipient_id,
      event_type,
      entity_type,
      entity_id,
      document_number,
      title,
      body,
      href
    )
    select distinct
      profile.id,
      'requisition_created',
      'requisition',
      new.id,
      new.document_number,
      'มีใบเบิกใหม่รอจ่าย',
      format('หน่วยงาน %s · ต้องการรับ %s', new.department, to_char(new.desired_date, 'DD/MM/YYYY')),
      '/requisitions/' || new.id::text
    from public.profiles profile
    left join public.lab_stock_memberships membership
      on membership.profile_id = profile.id
      and membership.active
    where profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.ephis_id = '9495'
        or membership.role in ('admin', 'stock_officer')
      )
    on conflict (recipient_id, event_type, entity_id) do nothing;
  end if;

  return new;
end
$function$;

revoke execute on function public.enqueue_requisition_notification() from public;
revoke execute on function public.enqueue_requisition_notification() from anon;
revoke execute on function public.enqueue_requisition_notification() from authenticated;

create or replace function public.resolve_lab_stock_notification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_table_name = 'purchase_requests'
    and old.status = 'pending'
    and new.status <> 'pending' then
    update public.lab_stock_notifications
    set resolved_at = coalesce(resolved_at, now())
    where entity_type = 'purchase_request'
      and entity_id = new.id
      and resolved_at is null;
  elsif tg_table_name = 'requisitions'
    and old.status = 'waiting'
    and new.status <> 'waiting' then
    update public.lab_stock_notifications
    set resolved_at = coalesce(resolved_at, now())
    where entity_type = 'requisition'
      and entity_id = new.id
      and resolved_at is null;
  end if;

  return new;
end
$function$;

revoke execute on function public.resolve_lab_stock_notification() from public;
revoke execute on function public.resolve_lab_stock_notification() from anon;
revoke execute on function public.resolve_lab_stock_notification() from authenticated;

drop trigger if exists purchase_requests_enqueue_notification on public.purchase_requests;
create trigger purchase_requests_enqueue_notification
after insert or update of status on public.purchase_requests
for each row execute function public.enqueue_purchase_request_notification();

drop trigger if exists requisitions_enqueue_notification on public.requisitions;
create trigger requisitions_enqueue_notification
after insert or update of status on public.requisitions
for each row execute function public.enqueue_requisition_notification();

drop trigger if exists purchase_requests_resolve_notification on public.purchase_requests;
create trigger purchase_requests_resolve_notification
after update of status on public.purchase_requests
for each row execute function public.resolve_lab_stock_notification();

drop trigger if exists requisitions_resolve_notification on public.requisitions;
create trigger requisitions_resolve_notification
after update of status on public.requisitions
for each row execute function public.resolve_lab_stock_notification();

do $publication$
begin
  alter publication supabase_realtime add table public.lab_stock_notifications;
exception
  when duplicate_object then null;
end
$publication$;

commit;
