begin;

-- Creating a receipt draft is a stock workflow. Heads may still use the other
-- workflows available to them, but they must not see or invoke this action.
create or replace function public.assert_goods_receipt_creator_actor(p_actor_id uuid)
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
        profile.ephis_id = '9495'
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
      message = 'actor is not allowed to create a goods receipt';
  end if;
end
$function$;

revoke execute on function public.assert_goods_receipt_creator_actor(uuid) from public;
revoke execute on function public.assert_goods_receipt_creator_actor(uuid) from anon;
revoke execute on function public.assert_goods_receipt_creator_actor(uuid) from authenticated;
grant execute on function public.assert_goods_receipt_creator_actor(uuid) to service_role;

commit;
