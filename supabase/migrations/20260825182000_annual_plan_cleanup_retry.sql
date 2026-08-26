-- Forward-only extension of the shared cleanup queue for annual-plan
-- retention. The original migration is intentionally left unchanged.
begin;

do $drop_constraints$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.storage_cleanup_jobs'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) ilike '%job_kind%'
  loop
    execute format(
      'alter table public.storage_cleanup_jobs drop constraint %I',
      constraint_name
    );
  end loop;
end
$drop_constraints$;

alter table public.storage_cleanup_jobs
  add constraint storage_cleanup_jobs_job_kind_check
  check (job_kind in (
    'checklist_upload_orphan',
    'storage_upload_rollback',
    'checklist_lifecycle_retry',
    'po_lifecycle_retry',
    'annual_plan_retention_retry'
  ));

alter table public.storage_cleanup_jobs
  add constraint storage_cleanup_jobs_job_shape_check
  check (
    (job_kind in ('checklist_upload_orphan', 'storage_upload_rollback')
      and storage_key is not null
      and nullif(btrim(coalesce(bucket_name, '')), '') is not null)
    or
    (job_kind in ('checklist_lifecycle_retry', 'po_lifecycle_retry', 'annual_plan_retention_retry')
      and storage_key is null
      and bucket_name is null
      and resource_id is not null)
  );

alter table public.storage_cleanup_jobs
  add constraint storage_cleanup_jobs_checklist_path_check
  check (job_kind <> 'checklist_upload_orphan' or (
    storage_backend = 'r2'
    and bucket_name = '__r2__'
    and storage_key like 'labcbh-stock/pr-checklists/uploads/%'
    and resource_id is not null
  ));

alter table public.storage_cleanup_jobs
  add constraint storage_cleanup_jobs_storage_rollback_path_check
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
    or
    (storage_backend = 'supabase_storage'
      and bucket_name = 'lab-stock-annual-plans'
      and storage_key like 'annual-plans/%')
  ));

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
    'po_lifecycle_retry',
    'annual_plan_retention_retry'
  ) then
    raise exception using errcode = '22023', message = 'invalid storage cleanup job kind';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'storage cleanup metadata must be an object';
  end if;
  if p_job_kind in ('checklist_lifecycle_retry', 'po_lifecycle_retry', 'annual_plan_retention_retry') then
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

revoke execute on function public.enqueue_storage_cleanup_job(text, text, text, text, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.enqueue_storage_cleanup_job(text, text, text, text, uuid, jsonb, timestamptz)
  to service_role;

commit;
