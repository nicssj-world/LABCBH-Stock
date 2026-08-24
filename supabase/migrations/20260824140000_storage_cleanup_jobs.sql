-- Durable cleanup queue for storage objects that outlive the request which
-- created them. The queue is service-role only; application writes still go
-- through RPCs, and the worker never touches contract_usage.
begin;

alter table public.purchase_request_upload_tickets
  add column if not exists cleanup_locked_until timestamptz,
  add column if not exists object_deleted_at timestamptz;

create table public.storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  storage_backend text not null check (storage_backend in ('r2', 'supabase_storage')),
  bucket_name text,
  storage_key text,
  job_kind text not null check (job_kind in (
    'checklist_upload_orphan',
    'storage_upload_rollback',
    'checklist_lifecycle_retry',
    'po_lifecycle_retry'
  )),
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check (
    (job_kind in ('checklist_upload_orphan', 'storage_upload_rollback')
      and storage_key is not null
      and nullif(btrim(coalesce(bucket_name, '')), '') is not null)
    or
    (job_kind in ('checklist_lifecycle_retry', 'po_lifecycle_retry')
      and storage_key is null
      and bucket_name is null
      and resource_id is not null)
  ),
  check (storage_key is null or (nullif(btrim(storage_key), '') is not null and storage_key not like '%..%')),
  check (job_kind <> 'checklist_upload_orphan' or (
    storage_backend = 'r2'
    and bucket_name = '__r2__'
    and storage_key like 'labcbh-stock/pr-checklists/uploads/%'
    and resource_id is not null
  )),
  check (job_kind <> 'storage_upload_rollback' or (
    (storage_backend = 'r2'
      and bucket_name = '__r2__'
      and storage_key like 'labcbh-stock/pr-checklists/uploads/%')
    or
    (storage_backend = 'supabase_storage'
      and bucket_name in ('lab-stock-po', 'lab-stock-contracts')
      and (
        storage_key like 'po/%'
        or storage_key like 'contracts/%'
        or storage_key like 'out-lab/%'
      ))
  ))
);

create unique index storage_cleanup_jobs_object_key
  on public.storage_cleanup_jobs (storage_backend, bucket_name, storage_key)
  where completed_at is null and cancelled_at is null and storage_key is not null;

create unique index storage_cleanup_jobs_resource_key
  on public.storage_cleanup_jobs (job_kind, resource_id)
  where completed_at is null and cancelled_at is null and resource_id is not null;

create index storage_cleanup_jobs_available_idx
  on public.storage_cleanup_jobs (available_at, created_at)
  where completed_at is null and cancelled_at is null;

alter table public.storage_cleanup_jobs enable row level security;
revoke all on table public.storage_cleanup_jobs from anon, authenticated;
grant select, insert, update on table public.storage_cleanup_jobs to service_role;

create or replace function public.enqueue_storage_cleanup_job(
  p_storage_backend text,
  p_bucket_name text,
  p_storage_key text,
  p_job_kind text,
  p_resource_id uuid,
  p_metadata jsonb,
  p_available_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  job_id uuid;
begin
  if p_storage_backend not in ('r2', 'supabase_storage') then
    raise exception using errcode = '22023', message = 'invalid storage cleanup backend';
  end if;
  if p_job_kind not in (
    'checklist_upload_orphan',
    'storage_upload_rollback',
    'checklist_lifecycle_retry',
    'po_lifecycle_retry'
  ) then
    raise exception using errcode = '22023', message = 'invalid storage cleanup job kind';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'storage cleanup metadata must be an object';
  end if;
  if p_job_kind in ('checklist_lifecycle_retry', 'po_lifecycle_retry') then
    if p_resource_id is null or p_storage_key is not null or p_bucket_name is not null then
      raise exception using errcode = '22023', message = 'lifecycle cleanup jobs need a resource id only';
    end if;
  elsif p_storage_key is null or p_bucket_name is null then
    raise exception using errcode = '22023', message = 'object cleanup jobs need a bucket and storage key';
  end if;

  insert into public.storage_cleanup_jobs (
    storage_backend, bucket_name, storage_key, job_kind, resource_id,
    metadata, available_at
  ) values (
    p_storage_backend, p_bucket_name, p_storage_key, p_job_kind, p_resource_id,
    coalesce(p_metadata, '{}'::jsonb), coalesce(p_available_at, now())
  )
  on conflict do nothing
  returning id into job_id;

  if job_id is null then
    update public.storage_cleanup_jobs job
    set metadata = coalesce(p_metadata, '{}'::jsonb),
        available_at = least(job.available_at, coalesce(p_available_at, now())),
        locked_until = null,
        last_error = null
    where job.completed_at is null
      and job.cancelled_at is null
      and job.job_kind = p_job_kind
      and (
        (p_resource_id is not null and job.resource_id = p_resource_id)
        or (p_resource_id is null and job.storage_backend = p_storage_backend
          and job.bucket_name = p_bucket_name and job.storage_key = p_storage_key)
      );
    select job.id into job_id
    from public.storage_cleanup_jobs job
    where job.completed_at is null
      and job.cancelled_at is null
      and job.job_kind = p_job_kind
      and (
        (p_resource_id is not null and job.resource_id = p_resource_id)
        or (p_resource_id is null and job.storage_backend = p_storage_backend
          and job.bucket_name = p_bucket_name and job.storage_key = p_storage_key)
      )
    order by job.created_at desc
    limit 1;
  end if;

  return job_id;
end
$function$;

create or replace function public.claim_storage_cleanup_jobs(p_limit integer default 25)
returns setof public.storage_cleanup_jobs
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'storage cleanup batch size must be between 1 and 100';
  end if;

  return query
  with candidates as (
    select job.id
    from public.storage_cleanup_jobs job
    where job.completed_at is null
      and job.cancelled_at is null
      and job.available_at <= now()
      and (job.locked_until is null or job.locked_until <= now())
    order by job.available_at, job.created_at
    for update skip locked
    limit p_limit
  )
  update public.storage_cleanup_jobs job
  set attempts = job.attempts + 1,
      locked_until = now() + interval '10 minutes',
      last_error = null
  from candidates
  where job.id = candidates.id
  returning job.*;
end
$function$;

create or replace function public.complete_storage_cleanup_job(
  p_job_id uuid,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_success then
    update public.storage_cleanup_jobs
    set completed_at = coalesce(completed_at, now()),
        locked_until = null,
        last_error = null
    where id = p_job_id and cancelled_at is null;
  else
    update public.storage_cleanup_jobs
    set locked_until = null,
        available_at = now() + make_interval(mins => least(60, greatest(1, attempts * 5))),
        last_error = left(coalesce(nullif(btrim(p_error), ''), 'storage cleanup failed'), 2000)
    where id = p_job_id and completed_at is null and cancelled_at is null;
  end if;
end
$function$;

create or replace function public.cancel_storage_cleanup_job(
  p_job_kind text,
  p_resource_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.storage_cleanup_jobs
  set cancelled_at = coalesce(cancelled_at, now()), locked_until = null
  where job_kind = p_job_kind
    and resource_id = p_resource_id
    and completed_at is null
    and cancelled_at is null;
end
$function$;

create or replace function public.begin_purchase_request_upload_object_cleanup(p_ticket_id uuid)
returns table (id uuid, storage_key text)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  return query
  update public.purchase_request_upload_tickets ticket
  set cleanup_locked_until = now() + interval '10 minutes'
  where ticket.id = p_ticket_id
    and ticket.claimed_at is null
    and ticket.object_deleted_at is null
    and (ticket.cancelled_at is not null or ticket.expires_at <= now())
    and (ticket.cleanup_locked_until is null or ticket.cleanup_locked_until <= now())
  returning ticket.id, ticket.storage_key;
end
$function$;

create or replace function public.mark_purchase_request_upload_object_deleted(p_ticket_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  deleted_count integer := 0;
  attached_pr_id uuid;
begin
  update public.purchase_request_upload_tickets ticket
  set object_deleted_at = coalesce(ticket.object_deleted_at, now()),
      cleanup_locked_until = null
  where ticket.id = p_ticket_id
    and ticket.claimed_at is null
    and ticket.object_deleted_at is null
    and (ticket.cancelled_at is not null or ticket.expires_at <= now());
  if found then
    deleted_count := 1;
    select ticket.purchase_request_id into attached_pr_id
    from public.purchase_request_upload_tickets ticket
    where ticket.id = p_ticket_id;
    if attached_pr_id is not null then
      insert into public.purchase_request_checklist_events (
        purchase_request_id, event_type, detail
      ) values (
        attached_pr_id, 'upload_object_deleted', jsonb_build_object('uploadTicketId', p_ticket_id)
      );
    end if;
  end if;
  return jsonb_build_object('deletedCount', deleted_count);
end
$function$;

create or replace function public.release_purchase_request_upload_object_cleanup(p_ticket_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.purchase_request_upload_tickets
  set cleanup_locked_until = null
  where id = p_ticket_id and object_deleted_at is null;
end
$function$;

create or replace function public.enqueue_purchase_request_upload_cleanup_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.storage_cleanup_jobs (
    storage_backend, bucket_name, storage_key, job_kind, resource_id, available_at,
    metadata
  ) values (
    'r2', '__r2__', new.storage_key, 'checklist_upload_orphan', new.id, new.expires_at,
    jsonb_build_object('uploadTicketId', new.id, 'uploadSessionId', new.upload_session_id)
  )
  on conflict do nothing;
  return new;
end
$function$;

create or replace function public.sync_purchase_request_upload_cleanup_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.claimed_at is not null and old.claimed_at is null then
    update public.storage_cleanup_jobs
    set cancelled_at = coalesce(cancelled_at, now()), locked_until = null
    where job_kind = 'checklist_upload_orphan'
      and resource_id = new.id
      and completed_at is null
      and cancelled_at is null;
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    update public.storage_cleanup_jobs
    set available_at = least(available_at, now()), locked_until = null, last_error = null
    where job_kind = 'checklist_upload_orphan'
      and resource_id = new.id
      and completed_at is null
      and cancelled_at is null;
  end if;
  return new;
end
$function$;

create or replace function public.prevent_purchase_request_upload_claim_during_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.claimed_at is not null
     and old.claimed_at is null
     and old.cleanup_locked_until is not null
     and old.cleanup_locked_until > now() then
    raise exception using errcode = '55000', message = 'upload ticket cleanup is in progress';
  end if;
  return new;
end
$function$;

drop trigger if exists purchase_request_upload_ticket_cleanup_enqueue on public.purchase_request_upload_tickets;
create trigger purchase_request_upload_ticket_cleanup_enqueue
after insert on public.purchase_request_upload_tickets
for each row execute function public.enqueue_purchase_request_upload_cleanup_job();

drop trigger if exists purchase_request_upload_ticket_cleanup_sync on public.purchase_request_upload_tickets;
create trigger purchase_request_upload_ticket_cleanup_sync
after update of claimed_at, cancelled_at on public.purchase_request_upload_tickets
for each row execute function public.sync_purchase_request_upload_cleanup_job();

drop trigger if exists purchase_request_upload_ticket_cleanup_guard on public.purchase_request_upload_tickets;
create trigger purchase_request_upload_ticket_cleanup_guard
before update of claimed_at on public.purchase_request_upload_tickets
for each row execute function public.prevent_purchase_request_upload_claim_during_cleanup();

revoke execute on function public.enqueue_storage_cleanup_job(text, text, text, text, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_storage_cleanup_jobs(integer) from public, anon, authenticated;
revoke execute on function public.complete_storage_cleanup_job(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.cancel_storage_cleanup_job(text, uuid) from public, anon, authenticated;
revoke execute on function public.begin_purchase_request_upload_object_cleanup(uuid) from public, anon, authenticated;
revoke execute on function public.mark_purchase_request_upload_object_deleted(uuid) from public, anon, authenticated;
revoke execute on function public.release_purchase_request_upload_object_cleanup(uuid) from public, anon, authenticated;
revoke execute on function public.enqueue_purchase_request_upload_cleanup_job() from public, anon, authenticated;
revoke execute on function public.sync_purchase_request_upload_cleanup_job() from public, anon, authenticated;
revoke execute on function public.prevent_purchase_request_upload_claim_during_cleanup() from public, anon, authenticated;

grant execute on function public.enqueue_storage_cleanup_job(text, text, text, text, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.claim_storage_cleanup_jobs(integer) to service_role;
grant execute on function public.complete_storage_cleanup_job(uuid, boolean, text) to service_role;
grant execute on function public.cancel_storage_cleanup_job(text, uuid) to service_role;
grant execute on function public.begin_purchase_request_upload_object_cleanup(uuid) to service_role;
grant execute on function public.mark_purchase_request_upload_object_deleted(uuid) to service_role;
grant execute on function public.release_purchase_request_upload_object_cleanup(uuid) to service_role;

commit;
