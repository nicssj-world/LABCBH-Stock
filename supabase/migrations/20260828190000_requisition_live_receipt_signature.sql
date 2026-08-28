-- Use the receiver's current Portal signature when a requisition is rendered.
-- Keep the legacy signature column for rows written by the snapshot workflow,
-- but do not write a signature image into new receipt rows.

begin;

alter table public.requisitions
  drop constraint if exists requisitions_signed_check;

alter table public.requisitions
  drop constraint if exists requisitions_receipt_check;

alter table public.requisitions
  add constraint requisitions_receipt_check check (
    (status = 'received') = (
      signed_at is not null
      and nullif(btrim(received_by_name), '') is not null
    )
    and (signed_at is not null) = (nullif(btrim(received_by_name), '') is not null)
  );

-- Replace the snapshot-taking RPC. The server action still verifies that the
-- actor has a current Portal signature before calling this function, while
-- the database records only who received the goods and when.
drop function if exists public.receive_requisition(uuid, uuid, text, text);

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

  perform public.assert_requisition_manager(p_actor_id, row_locked_requisition.requester_id);

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
