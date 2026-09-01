-- Receipt confirmation is a shared operational step. Any active LAB Stock
-- user may confirm a fulfilled requisition; editing and cancelling remain
-- restricted by assert_requisition_manager.

begin;

create or replace function public.assert_requisition_receiver(p_actor_id uuid)
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
        or profile.role = 'Manager'
        or exists (
          select 1
          from public.lab_stock_memberships membership
          where membership.profile_id = profile.id
            and membership.active
        )
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'actor is not allowed to confirm requisition receipt';
  end if;
end
$function$;

revoke execute on function public.assert_requisition_receiver(uuid) from public;
revoke execute on function public.assert_requisition_receiver(uuid) from anon;
revoke execute on function public.assert_requisition_receiver(uuid) from authenticated;
grant execute on function public.assert_requisition_receiver(uuid) to service_role;

create or replace function public.receive_requisition(
  p_requisition_id uuid,
  p_actor_id uuid,
  p_received_by_name text
)
returns public.requisitions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  row_locked_requisition public.requisitions%rowtype;
  row_received_requisition public.requisitions%rowtype;
  v_received_by_name text;
begin
  v_received_by_name := nullif(btrim(coalesce(p_received_by_name, '')), '');

  if v_received_by_name is null then
    raise exception using errcode = '23502', message = 'receiver name is required';
  end if;

  select requisition.*
  into row_locked_requisition
  from public.requisitions as requisition
  where requisition.id = p_requisition_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'requisition not found';
  end if;

  if row_locked_requisition.status <> 'fulfilled' then
    raise exception using
      errcode = '55000',
      message = format('requisition is %s and cannot be received yet', row_locked_requisition.status);
  end if;

  if row_locked_requisition.signed_at is not null then
    raise exception using errcode = '55000', message = 'requisition has already been received';
  end if;

  perform public.assert_requisition_receiver(p_actor_id);

  update public.requisitions as requisition
  set status = 'received',
      received_by = p_actor_id,
      received_by_name = v_received_by_name,
      signature = null,
      signed_at = now(),
      updated_by = p_actor_id
  where requisition.id = row_locked_requisition.id
  returning requisition.* into row_received_requisition;

  insert into public.audit_log(action, user_id, target, detail)
  values (
    'requisition.receipt_confirmed',
    p_actor_id,
    row_received_requisition.id::text,
    jsonb_build_object(
      'document_number', row_received_requisition.document_number,
      'status', row_received_requisition.status,
      'received_by_name', row_received_requisition.received_by_name,
      'signature_source', 'portal_live'
    )::text
  );

  return row_received_requisition;
end
$function$;

revoke execute on function public.receive_requisition(uuid, uuid, text) from public;
revoke execute on function public.receive_requisition(uuid, uuid, text) from anon;
revoke execute on function public.receive_requisition(uuid, uuid, text) from authenticated;
grant execute on function public.receive_requisition(uuid, uuid, text) to service_role;

commit;
