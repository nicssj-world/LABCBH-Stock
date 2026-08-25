-- Keep the name of the stock officer who fulfilled a requisition available to
-- every authorised reader. The shared profiles table intentionally exposes
-- only the current user's row through RLS, so an audit display must not depend
-- on a cross-profile relationship being visible to the session.

begin;

alter table public.requisitions
  add column if not exists fulfilled_by_name text;

-- Preserve the name for requisitions fulfilled before this snapshot existed.
update public.requisitions as requisition
set fulfilled_by_name = nullif(btrim(profile.name), '')
from public.profiles as profile
where requisition.fulfilled_by = profile.id
  and requisition.fulfilled_by_name is null;

create or replace function public.snapshot_requisition_fulfiller_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.fulfilled_by is null then
    new.fulfilled_by_name := null;
  elsif tg_op = 'INSERT' then
    select nullif(btrim(profile.name), '')
    into new.fulfilled_by_name
    from public.profiles as profile
    where profile.id = new.fulfilled_by;
  elsif new.fulfilled_by is distinct from old.fulfilled_by then
    select nullif(btrim(profile.name), '')
    into new.fulfilled_by_name
    from public.profiles as profile
    where profile.id = new.fulfilled_by;
  end if;

  return new;
end
$function$;

revoke execute on function public.snapshot_requisition_fulfiller_name() from public;
revoke execute on function public.snapshot_requisition_fulfiller_name() from anon;
revoke execute on function public.snapshot_requisition_fulfiller_name() from authenticated;

drop trigger if exists requisitions_snapshot_fulfiller_name on public.requisitions;
create trigger requisitions_snapshot_fulfiller_name
before insert or update of fulfilled_by on public.requisitions
for each row execute function public.snapshot_requisition_fulfiller_name();

commit;
