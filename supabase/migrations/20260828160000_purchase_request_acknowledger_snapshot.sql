-- Keep the stock officer's identity on the PR itself. The shared profiles
-- table intentionally exposes only the current user's row through RLS, so a
-- printed audit document must not depend on a cross-profile relationship.

begin;

alter table public.purchase_requests
  add column if not exists acknowledged_by_name text;

-- Preserve the name for PRs confirmed before this snapshot existed.
update public.purchase_requests as purchase_request
set acknowledged_by_name = nullif(btrim(profile.name), '')
from public.profiles as profile
where purchase_request.acknowledged_by = profile.id
  and purchase_request.acknowledged_by_name is null;

create or replace function public.snapshot_purchase_request_acknowledger_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.acknowledged_by is null then
    new.acknowledged_by_name := null;
  elsif tg_op = 'INSERT'
     or new.acknowledged_by is distinct from old.acknowledged_by
     or new.acknowledged_by_name is distinct from old.acknowledged_by_name then
    select nullif(btrim(profile.name), '')
    into new.acknowledged_by_name
    from public.profiles as profile
    where profile.id = new.acknowledged_by;
  end if;

  return new;
end
$function$;

revoke execute on function public.snapshot_purchase_request_acknowledger_name() from public;
revoke execute on function public.snapshot_purchase_request_acknowledger_name() from anon;
revoke execute on function public.snapshot_purchase_request_acknowledger_name() from authenticated;

drop trigger if exists purchase_requests_snapshot_acknowledger_name on public.purchase_requests;
create trigger purchase_requests_snapshot_acknowledger_name
before insert or update of acknowledged_by, acknowledged_by_name on public.purchase_requests
for each row execute function public.snapshot_purchase_request_acknowledger_name();

commit;
