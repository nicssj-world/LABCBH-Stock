-- Restore the PR manager guard required by the checklist RPCs.
--
-- Some hosted environments received the later checklist migrations without
-- the earlier PR edit/cancel migration. Keep this as a small forward-only
-- repair so creating or editing a checklist-backed PR never depends on
-- migration-ledger order being perfect.
begin;

create or replace function public.assert_purchase_request_manager(
  p_actor_id uuid,
  p_requester_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.id = p_requester_id
        or profile.ephis_id = '9495'
        or exists (
          select 1
          from public.lab_stock_memberships membership
          where membership.profile_id = profile.id
            and membership.active
            and membership.role in ('admin', 'stock_officer')
        )
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'actor is not allowed to edit or cancel this purchase request';
  end if;
end
$function$;

revoke execute on function public.assert_purchase_request_manager(uuid, uuid) from public;
revoke execute on function public.assert_purchase_request_manager(uuid, uuid) from anon;
revoke execute on function public.assert_purchase_request_manager(uuid, uuid) from authenticated;
grant execute on function public.assert_purchase_request_manager(uuid, uuid) to service_role;

commit;
