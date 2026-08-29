-- A PO usage window must span at least two calendar dates.
-- Keep this constraint NOT VALID so historical same-day rows remain readable;
-- new inserts and updates are still checked by PostgreSQL.
do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'service_purchase_requests_usage_date_order_check'
      and conrelid = 'public.service_purchase_requests'::regclass
  ) then
    alter table public.service_purchase_requests
      add constraint service_purchase_requests_usage_date_order_check
      check (usage_start_date < usage_end_date)
      not valid;
  end if;
end
$migration$;
