-- Two gaps found reviewing the earlier budget migrations.
--
-- The lab-stock-contracts bucket was created with no policies at all, while
-- lab-stock-po has three. Nothing was exposed - storage.objects has RLS on, so
-- no policy means no access, and the application reaches storage through the
-- service role either way - but the defence in depth the design called for was
-- missing, and any future code path using the authenticated client would have
-- failed silently rather than being refused for a stated reason.
--
-- The mode guard also reported a null contract_id as though the contract were
-- the wrong type. No production row has a null contract_id, so nothing is
-- broken, but the message sent anyone debugging it down the wrong path.
begin;

-- Contract documents are legal evidence. Editors attach and replace them;
-- anyone with lab stock access may read one, matching the read scope of the
-- contract record itself.
drop policy if exists lab_stock_contract_file_editor_insert on storage.objects;
create policy lab_stock_contract_file_editor_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'lab-stock-contracts'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'head')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

drop policy if exists lab_stock_contract_file_app_select on storage.objects;
create policy lab_stock_contract_file_app_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'lab-stock-contracts'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

-- Replacing an existing document is an update, not an insert, so an upsert
-- needs both or a re-upload to the same path fails once the object exists.
drop policy if exists lab_stock_contract_file_editor_update on storage.objects;
create policy lab_stock_contract_file_editor_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'lab-stock-contracts'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'head')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

-- Say what is actually wrong when the row names no contract.
create or replace function public.guard_contract_tracking_mode()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_type text;
begin
  if new.contract_id is null then
    raise exception using
      errcode = '23502',
      message = format('%s requires a contract_id', tg_table_name);
  end if;

  -- Both contract_usage and contract_items carry contract_id, so one lookup
  -- serves both triggers.
  select contract.contract_type into target_type
  from public.contracts contract
  where contract.id = new.contract_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = format('contract %s does not exist', new.contract_id);
  end if;

  if tg_argv[0] = 'usage' and target_type is distinct from 'equipment_lease' then
    raise exception using
      errcode = '23514',
      message = 'budget entries are only valid on an equipment lease contract';
  end if;

  if tg_argv[0] = 'items' and target_type = 'equipment_lease' then
    raise exception using
      errcode = '23514',
      message = 'an equipment lease contract is tracked by budget and cannot hold line items';
  end if;

  return new;
end
$function$;

revoke execute on function public.guard_contract_tracking_mode() from public;
revoke execute on function public.guard_contract_tracking_mode() from anon;
revoke execute on function public.guard_contract_tracking_mode() from authenticated;

commit;
