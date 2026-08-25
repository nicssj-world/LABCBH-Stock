-- The target environment confirmed the legacy Out Lab contract data and
-- objects are empty. Remove only its queued cleanup rows and retire the old
-- storage prefix from the shared queue; service documents use a new prefix.
begin;

delete from public.storage_cleanup_jobs
where bucket_name = 'lab-stock-contracts'
  and storage_key like 'out-lab/%';

alter table public.storage_cleanup_jobs
  drop constraint if exists storage_cleanup_jobs_storage_rollback_path_check;

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
        or storage_key like 'service-procurement/%'
      ))
    or
    (storage_backend = 'supabase_storage'
      and bucket_name = 'lab-stock-annual-plans'
      and storage_key like 'annual-plans/%')
  ));

commit;
