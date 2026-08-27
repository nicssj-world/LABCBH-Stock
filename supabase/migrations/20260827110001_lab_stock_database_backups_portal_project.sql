-- Idempotent backup queue/RPC bundle for the LabManagement Portal project.
-- This project owns its own backup audit trail; the desktop runner uses the
-- service-role-only RPCs below while pg_dump connects to this project's database.

-- Local database backup request queue and audit trail.
--
-- The web application only creates and observes a request. A trusted local
-- runner claims the request, runs pg_dump directly against Postgres, and
-- reports the resulting artifact metadata back through the service role.
begin;

create table if not exists public.lab_stock_backup_runs (
  id uuid primary key default gen_random_uuid(),
  project_ref text not null check (nullif(btrim(project_ref), '') is not null),
  status text not null default 'requested' check (status in (
    'requested',
    'running',
    'succeeded',
    'failed',
    'pruned'
  )),
  trigger_source text not null check (trigger_source in ('manual', 'scheduled')),
  requested_by uuid references public.profiles(id) on delete set null,
  runner_id text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  file_name text,
  relative_path text,
  bytes bigint check (bytes is null or bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create unique index if not exists lab_stock_backup_runs_active_project_key
  on public.lab_stock_backup_runs (lower(project_ref))
  where status in ('requested', 'running');

create index if not exists lab_stock_backup_runs_project_requested_idx
  on public.lab_stock_backup_runs (lower(project_ref), requested_at desc);

create index if not exists lab_stock_backup_runs_status_requested_idx
  on public.lab_stock_backup_runs (status, requested_at desc);

alter table public.lab_stock_backup_runs enable row level security;
revoke all on table public.lab_stock_backup_runs from anon, authenticated;
grant select, insert, update, delete on table public.lab_stock_backup_runs to service_role;

-- A runner heartbeat lets the web surface distinguish "a request is waiting"
-- from "the local worker has not checked in recently" without exposing any
-- machine secrets or requiring the dump itself to pass through the web app.
create table if not exists public.lab_stock_backup_runners (
  runner_id text not null check (nullif(btrim(runner_id), '') is not null),
  project_ref text not null check (nullif(btrim(project_ref), '') is not null),
  version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (runner_id, project_ref)
);

create index if not exists lab_stock_backup_runners_project_seen_idx
  on public.lab_stock_backup_runners (lower(project_ref), last_seen_at desc);

alter table public.lab_stock_backup_runners enable row level security;
revoke all on table public.lab_stock_backup_runners from anon, authenticated;
grant select, insert, update, delete on table public.lab_stock_backup_runners to service_role;

-- The application passes the resolved actor explicitly because these calls run
-- through supabaseAdmin. The database still re-checks the current profile and
-- membership, so a mistake in a Server Action cannot widen access.
create or replace function public.request_lab_stock_backup(
  p_actor_id uuid,
  p_project_ref text
)
returns public.lab_stock_backup_runs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_project_ref text;
  created_run public.lab_stock_backup_runs%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  normalized_project_ref := nullif(btrim(coalesce(p_project_ref, '')), '');
  if normalized_project_ref is null or length(normalized_project_ref) > 128 then
    raise exception using errcode = '22023', message = 'backup project reference is invalid';
  end if;

  insert into public.lab_stock_backup_runs (
    project_ref,
    status,
    trigger_source,
    requested_by
  ) values (
    normalized_project_ref,
    'requested',
    'manual',
    p_actor_id
  )
  on conflict do nothing
  returning * into created_run;

  if created_run.id is null then
    select *
    into created_run
    from public.lab_stock_backup_runs run
    where lower(run.project_ref) = lower(normalized_project_ref)
      and run.status in ('requested', 'running')
    order by run.requested_at desc
    limit 1;
  end if;

  return created_run;
end
$function$;

revoke execute on function public.request_lab_stock_backup(uuid, text) from public;
revoke execute on function public.request_lab_stock_backup(uuid, text) from anon;
revoke execute on function public.request_lab_stock_backup(uuid, text) from authenticated;
grant execute on function public.request_lab_stock_backup(uuid, text) to service_role;

-- Scheduled requests are created by the trusted local runner. There is no user
-- actor for a Windows Task Scheduler invocation, so this endpoint is kept
-- service-role-only and cannot be called by a browser session.
create or replace function public.enqueue_lab_stock_backup(
  p_project_ref text
)
returns public.lab_stock_backup_runs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_project_ref text;
  created_run public.lab_stock_backup_runs%rowtype;
begin
  normalized_project_ref := nullif(btrim(coalesce(p_project_ref, '')), '');
  if normalized_project_ref is null or length(normalized_project_ref) > 128 then
    raise exception using errcode = '22023', message = 'backup project reference is invalid';
  end if;

  insert into public.lab_stock_backup_runs (
    project_ref,
    status,
    trigger_source
  ) values (
    normalized_project_ref,
    'requested',
    'scheduled'
  )
  on conflict do nothing
  returning * into created_run;

  if created_run.id is null then
    select *
    into created_run
    from public.lab_stock_backup_runs run
    where lower(run.project_ref) = lower(normalized_project_ref)
      and run.status in ('requested', 'running')
    order by run.requested_at desc
    limit 1;
  end if;

  return created_run;
end
$function$;

revoke execute on function public.enqueue_lab_stock_backup(text) from public;
revoke execute on function public.enqueue_lab_stock_backup(text) from anon;
revoke execute on function public.enqueue_lab_stock_backup(text) from authenticated;
grant execute on function public.enqueue_lab_stock_backup(text) to service_role;

create or replace function public.heartbeat_lab_stock_backup_runner(
  p_runner_id text,
  p_project_ref text,
  p_version text default null
)
returns public.lab_stock_backup_runners
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_runner_id text;
  normalized_project_ref text;
  normalized_version text;
  heartbeat public.lab_stock_backup_runners%rowtype;
begin
  normalized_runner_id := nullif(btrim(coalesce(p_runner_id, '')), '');
  normalized_project_ref := nullif(btrim(coalesce(p_project_ref, '')), '');
  normalized_version := nullif(btrim(coalesce(p_version, '')), '');

  if normalized_runner_id is null or length(normalized_runner_id) > 128 then
    raise exception using errcode = '22023', message = 'backup runner id is invalid';
  end if;
  if normalized_project_ref is null or length(normalized_project_ref) > 128 then
    raise exception using errcode = '22023', message = 'backup project reference is invalid';
  end if;

  insert into public.lab_stock_backup_runners (
    runner_id,
    project_ref,
    version,
    last_seen_at,
    updated_at
  ) values (
    normalized_runner_id,
    normalized_project_ref,
    left(normalized_version, 80),
    now(),
    now()
  )
  on conflict (runner_id, project_ref) do update
    set version = excluded.version,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
  returning * into heartbeat;

  return heartbeat;
end
$function$;

revoke execute on function public.heartbeat_lab_stock_backup_runner(text, text, text) from public;
revoke execute on function public.heartbeat_lab_stock_backup_runner(text, text, text) from anon;
revoke execute on function public.heartbeat_lab_stock_backup_runner(text, text, text) from authenticated;
grant execute on function public.heartbeat_lab_stock_backup_runner(text, text, text) to service_role;

create or replace function public.claim_lab_stock_backup(
  p_runner_id text,
  p_project_ref text
)
returns public.lab_stock_backup_runs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_runner_id text;
  normalized_project_ref text;
  claimed_run public.lab_stock_backup_runs%rowtype;
begin
  normalized_runner_id := nullif(btrim(coalesce(p_runner_id, '')), '');
  normalized_project_ref := nullif(btrim(coalesce(p_project_ref, '')), '');

  if normalized_runner_id is null or length(normalized_runner_id) > 128 then
    raise exception using errcode = '22023', message = 'backup runner id is invalid';
  end if;
  if normalized_project_ref is null or length(normalized_project_ref) > 128 then
    raise exception using errcode = '22023', message = 'backup project reference is invalid';
  end if;

  with candidate as (
    select run.id
    from public.lab_stock_backup_runs run
    where lower(run.project_ref) = lower(normalized_project_ref)
      and (
        run.status = 'requested'
        or (run.status = 'running' and run.lease_expires_at <= now())
      )
    order by run.requested_at asc
    for update skip locked
    limit 1
  )
  update public.lab_stock_backup_runs run
  set status = 'running',
      runner_id = normalized_runner_id,
      started_at = now(),
      completed_at = null,
      lease_expires_at = now() + interval '6 hours',
      attempts = run.attempts + 1,
      file_name = null,
      relative_path = null,
      bytes = null,
      sha256 = null,
      error_code = null,
      error_message = null,
      metadata = run.metadata || jsonb_build_object('claimed_at', now())
  from candidate
  where run.id = candidate.id
  returning run.* into claimed_run;

  if claimed_run.id is null then
    return null;
  end if;

  return claimed_run;
end
$function$;

revoke execute on function public.claim_lab_stock_backup(text, text) from public;
revoke execute on function public.claim_lab_stock_backup(text, text) from anon;
revoke execute on function public.claim_lab_stock_backup(text, text) from authenticated;
grant execute on function public.claim_lab_stock_backup(text, text) to service_role;

create or replace function public.complete_lab_stock_backup(
  p_run_id uuid,
  p_runner_id text,
  p_file_name text,
  p_relative_path text,
  p_bytes bigint,
  p_sha256 text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.lab_stock_backup_runs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_runner_id text;
  normalized_file_name text;
  normalized_relative_path text;
  normalized_sha256 text;
  completed_run public.lab_stock_backup_runs%rowtype;
begin
  normalized_runner_id := nullif(btrim(coalesce(p_runner_id, '')), '');
  normalized_file_name := nullif(btrim(coalesce(p_file_name, '')), '');
  normalized_relative_path := nullif(btrim(coalesce(p_relative_path, '')), '');
  normalized_sha256 := lower(nullif(btrim(coalesce(p_sha256, '')), ''));

  if normalized_runner_id is null
     or normalized_file_name is null
     or normalized_relative_path is null
     or normalized_relative_path like '%..%'
     or length(normalized_relative_path) > 512
     or p_bytes is null
     or p_bytes < 0
     or normalized_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'backup completion metadata is invalid';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'backup metadata must be an object';
  end if;

  update public.lab_stock_backup_runs run
  set status = 'succeeded',
      completed_at = now(),
      lease_expires_at = null,
      file_name = normalized_file_name,
      relative_path = normalized_relative_path,
      bytes = p_bytes,
      sha256 = normalized_sha256,
      error_code = null,
      error_message = null,
      metadata = run.metadata || coalesce(p_metadata, '{}'::jsonb)
  where run.id = p_run_id
    and run.status = 'running'
    and run.runner_id = normalized_runner_id
  returning run.* into completed_run;

  if completed_run.id is null then
    raise exception using errcode = '55000', message = 'backup run is not owned by this runner';
  end if;

  return completed_run;
end
$function$;

revoke execute on function public.complete_lab_stock_backup(uuid, text, text, text, bigint, text, jsonb) from public;
revoke execute on function public.complete_lab_stock_backup(uuid, text, text, text, bigint, text, jsonb) from anon;
revoke execute on function public.complete_lab_stock_backup(uuid, text, text, text, bigint, text, jsonb) from authenticated;
grant execute on function public.complete_lab_stock_backup(uuid, text, text, text, bigint, text, jsonb) to service_role;

create or replace function public.fail_lab_stock_backup(
  p_run_id uuid,
  p_runner_id text,
  p_error_code text,
  p_error_message text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.lab_stock_backup_runs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_runner_id text;
  normalized_error_code text;
  normalized_error_message text;
  failed_run public.lab_stock_backup_runs%rowtype;
begin
  normalized_runner_id := nullif(btrim(coalesce(p_runner_id, '')), '');
  normalized_error_code := nullif(btrim(coalesce(p_error_code, '')), '');
  normalized_error_message := left(nullif(btrim(coalesce(p_error_message, '')), ''), 2000);

  if normalized_runner_id is null or normalized_error_message is null then
    raise exception using errcode = '22023', message = 'backup failure metadata is invalid';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'backup metadata must be an object';
  end if;

  update public.lab_stock_backup_runs run
  set status = 'failed',
      completed_at = now(),
      lease_expires_at = null,
      error_code = left(normalized_error_code, 120),
      error_message = normalized_error_message,
      metadata = run.metadata || coalesce(p_metadata, '{}'::jsonb)
  where run.id = p_run_id
    and run.status = 'running'
    and run.runner_id = normalized_runner_id
  returning run.* into failed_run;

  if failed_run.id is null then
    raise exception using errcode = '55000', message = 'backup run is not owned by this runner';
  end if;

  return failed_run;
end
$function$;

revoke execute on function public.fail_lab_stock_backup(uuid, text, text, text, jsonb) from public;
revoke execute on function public.fail_lab_stock_backup(uuid, text, text, text, jsonb) from anon;
revoke execute on function public.fail_lab_stock_backup(uuid, text, text, text, jsonb) from authenticated;
grant execute on function public.fail_lab_stock_backup(uuid, text, text, text, jsonb) to service_role;

create or replace function public.mark_lab_stock_backup_pruned(
  p_run_id uuid,
  p_relative_path text
)
returns public.lab_stock_backup_runs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_run public.lab_stock_backup_runs%rowtype;
begin
  if nullif(btrim(coalesce(p_relative_path, '')), '') is null
     or p_relative_path like '%..%' then
    raise exception using errcode = '22023', message = 'backup artifact path is invalid';
  end if;

  select *
  into target_run
  from public.lab_stock_backup_runs run
  where run.id = p_run_id
    and run.relative_path = btrim(p_relative_path)
    and run.status in ('succeeded', 'pruned');

  if target_run.id is null then
    raise exception using errcode = '55000', message = 'backup artifact cannot be marked pruned';
  end if;

  if target_run.status = 'succeeded' then
    update public.lab_stock_backup_runs run
    set status = 'pruned',
        metadata = run.metadata || jsonb_build_object('artifact_pruned_at', now())
    where run.id = p_run_id
    returning run.* into target_run;
  end if;

  return target_run;
end
$function$;

revoke execute on function public.mark_lab_stock_backup_pruned(uuid, text) from public;
revoke execute on function public.mark_lab_stock_backup_pruned(uuid, text) from anon;
revoke execute on function public.mark_lab_stock_backup_pruned(uuid, text) from authenticated;
grant execute on function public.mark_lab_stock_backup_pruned(uuid, text) to service_role;

commit;

-- Manual requests created by the trusted desktop runner.
--
-- The desktop application has no browser session to resolve an actor id.
-- Keep this endpoint service-role-only and retain the same active-run guard
-- used by the web request and scheduled runner paths.
begin;

create or replace function public.request_lab_stock_backup_from_runner(
  p_project_ref text
)
returns public.lab_stock_backup_runs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_project_ref text;
  created_run public.lab_stock_backup_runs%rowtype;
begin
  normalized_project_ref := nullif(btrim(coalesce(p_project_ref, '')), '');
  if normalized_project_ref is null or length(normalized_project_ref) > 128 then
    raise exception using errcode = '22023', message = 'backup project reference is invalid';
  end if;

  insert into public.lab_stock_backup_runs (
    project_ref,
    status,
    trigger_source
  ) values (
    normalized_project_ref,
    'requested',
    'manual'
  )
  on conflict do nothing
  returning * into created_run;

  if created_run.id is null then
    select *
    into created_run
    from public.lab_stock_backup_runs run
    where lower(run.project_ref) = lower(normalized_project_ref)
      and run.status in ('requested', 'running')
    order by run.requested_at desc
    limit 1;
  end if;

  return created_run;
end
$function$;

revoke execute on function public.request_lab_stock_backup_from_runner(text) from public;
revoke execute on function public.request_lab_stock_backup_from_runner(text) from anon;
revoke execute on function public.request_lab_stock_backup_from_runner(text) from authenticated;
grant execute on function public.request_lab_stock_backup_from_runner(text) to service_role;

commit;


