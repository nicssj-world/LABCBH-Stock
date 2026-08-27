-- Cover the nullable profile foreign key used by the backup audit trail.
-- The runner and UI already have purpose-built project/status indexes; this
-- index keeps profile deletes and FK checks from scanning the audit log.
create index if not exists lab_stock_backup_runs_requested_by_idx
  on public.lab_stock_backup_runs (requested_by)
  where requested_by is not null;
