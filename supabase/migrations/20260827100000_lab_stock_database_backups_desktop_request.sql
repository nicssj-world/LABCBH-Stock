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
