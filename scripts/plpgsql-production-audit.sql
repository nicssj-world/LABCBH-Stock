-- Run this script as one batch against Staging or Production before applying
-- a migration that creates or replaces PL/pgSQL functions. The extension and
-- every check are inside a transaction, so this audit does not persist schema
-- changes or data.
begin;

create extension if not exists plpgsql_check;

-- Review every reported error. Trigger-returning functions are intentionally
-- excluded because plpgsql_check needs a trigger relation for those bodies.
select
  p.oid::regprocedure::text as function_signature,
  checked.lineno,
  checked.sqlstate,
  checked.level,
  checked.message,
  checked.detail
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
cross join lateral plpgsql_check_function_tb(
  p.oid,
  fatal_errors => false
) as checked
where n.nspname = 'public'
  and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
  and p.prorettype <> 'trigger'::regtype
  and checked.level = 'error'
order by function_signature, checked.lineno;

-- _phleb is a known static-checker limitation in rejoin_tat: the function
-- creates that temporary table before using it. Any other error fails the
-- release audit and must be fixed before deployment.
do $audit$
declare
  unexpected_errors integer;
begin
  select count(*)
  into unexpected_errors
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  cross join lateral plpgsql_check_function_tb(
    p.oid,
    fatal_errors => false
  ) as checked
  where n.nspname = 'public'
    and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
    and p.prorettype <> 'trigger'::regtype
    and checked.level = 'error'
    and not (
      p.proname = 'rejoin_tat'
      and checked.sqlstate = '42P01'
      and position('_phleb' in coalesce(checked.message, '')) > 0
    );

  if unexpected_errors > 0 then
    raise exception 'PL/pgSQL production audit failed with % unexpected error(s)', unexpected_errors;
  end if;
end
$audit$;

rollback;
