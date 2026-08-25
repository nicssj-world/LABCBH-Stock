-- A fulfilled requisition is an audit event, not only a status label. Every
-- fulfilled row must retain the actor and timestamp that closed the issue.
-- This is independent from purchase-request receiving, whose partial-receipt
-- rules reconcile posted goods receipts and purchase-request quantities.

begin;

-- Repair legacy rows only from the immutable issue ledger. The last issue
-- movement is the closest recorded timestamp when an older requisition did
-- not persist fulfilled_at; never invent a time from an unrelated update.
with issue_audit as (
  select
    movement.source_document_id as requisition_id,
    max(movement.created_at) as fulfilled_at,
    (array_agg(movement.created_by order by movement.created_at desc))[1] as fulfilled_by
  from public.stock_movements as movement
  where movement.source_document_type = 'requisition'
    and movement.movement_type = 'requisition_issue'
    and movement.source_document_id is not null
  group by movement.source_document_id
)
update public.requisitions as requisition
set fulfilled_at = coalesce(requisition.fulfilled_at, issue_audit.fulfilled_at),
    fulfilled_by = coalesce(requisition.fulfilled_by, issue_audit.fulfilled_by)
from issue_audit
where requisition.id = issue_audit.requisition_id
  and requisition.status = 'fulfilled'
  and (requisition.fulfilled_at is null or requisition.fulfilled_by is null);

update public.requisitions as requisition
set fulfilled_by_name = nullif(btrim(profile.name), '')
from public.profiles as profile
where requisition.fulfilled_by = profile.id
  and requisition.status = 'fulfilled'
  and nullif(btrim(requisition.fulfilled_by_name), '') is null;

-- Keep the snapshot authoritative even if a service-role table update names
-- fulfilled_by_name explicitly. The profile name is captured at fulfilment;
-- later profile edits do not rewrite an unchanged snapshot.
create or replace function public.snapshot_requisition_fulfiller_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.fulfilled_by is null then
    new.fulfilled_by_name := null;
  elsif tg_op = 'INSERT'
     or new.fulfilled_by is distinct from old.fulfilled_by
     or new.fulfilled_by_name is distinct from old.fulfilled_by_name then
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
before insert or update of fulfilled_by, fulfilled_by_name on public.requisitions
for each row execute function public.snapshot_requisition_fulfiller_name();

do $audit_guard$
begin
  if exists (
    select 1
    from public.requisitions as requisition
    where requisition.status = 'fulfilled'
      and (
        requisition.fulfilled_at is null
        or requisition.fulfilled_by is null
        or nullif(btrim(requisition.fulfilled_by_name), '') is null
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'fulfilled requisitions are missing fulfillment audit data; reconcile the issue ledger before enabling the guard';
  end if;
end
$audit_guard$;

alter table public.requisitions
  drop constraint if exists requisitions_fulfilled_audit_check;

alter table public.requisitions
  add constraint requisitions_fulfilled_audit_check check (
    (status = 'fulfilled') = (
      fulfilled_at is not null
      and fulfilled_by is not null
      and nullif(btrim(fulfilled_by_name), '') is not null
    )
  );

commit;
