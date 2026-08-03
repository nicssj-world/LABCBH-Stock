-- A fulfilled requisition had no record of who physically received the
-- goods — only fulfilled_by (the stock officer who keyed in the dispensing).
-- Adds a digital-signature step: the recipient signs on-screen right after
-- fulfillment, captured as a data URI (small canvas PNG, no Storage bucket
-- needed) alongside their typed name and the exact moment they signed.
begin;

alter table public.requisitions
  add column if not exists received_by_name text;

alter table public.requisitions
  add column if not exists signature text;

alter table public.requisitions
  add column if not exists signed_at timestamptz;

alter table public.requisitions
  drop constraint if exists requisitions_signed_check;

alter table public.requisitions
  add constraint requisitions_signed_check check (
    (signed_at is not null) = (signature is not null)
    and (signed_at is not null) = (received_by_name is not null)
  );

create or replace function public.sign_requisition_receipt(
  p_requisition_id uuid,
  p_actor_id uuid,
  p_received_by_name text,
  p_signature text
)
returns public.requisitions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_requisition public.requisitions%rowtype;
  signed_requisition public.requisitions%rowtype;
  normalized_name text;
  normalized_signature text;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  normalized_name := nullif(btrim(coalesce(p_received_by_name, '')), '');
  normalized_signature := nullif(btrim(coalesce(p_signature, '')), '');

  if normalized_name is null then
    raise exception using errcode = '23502', message = 'receiver name is required';
  end if;

  if normalized_signature is null then
    raise exception using errcode = '23502', message = 'signature is required';
  end if;

  if left(normalized_signature, 22) <> 'data:image/png;base64,' then
    raise exception using errcode = '22023', message = 'signature must be a PNG data URI';
  end if;

  -- Lock first, then re-read status under the lock, same order as
  -- fulfill_requisition — checking before locking would let two people race
  -- the same signature.
  select *
  into locked_requisition
  from public.requisitions requisition
  where requisition.id = p_requisition_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'requisition not found';
  end if;

  if locked_requisition.status <> 'fulfilled' then
    raise exception using
      errcode = '55000',
      message = format('requisition is %s and cannot be signed for receipt yet', locked_requisition.status);
  end if;

  if locked_requisition.signed_at is not null then
    raise exception using errcode = '55000', message = 'requisition has already been signed for';
  end if;

  update public.requisitions
  set received_by_name = normalized_name,
      signature = normalized_signature,
      signed_at = now()
  where id = p_requisition_id
  returning * into signed_requisition;

  return signed_requisition;
end
$function$;

revoke execute on function public.sign_requisition_receipt(uuid, uuid, text, text) from public;
revoke execute on function public.sign_requisition_receipt(uuid, uuid, text, text) from anon;
revoke execute on function public.sign_requisition_receipt(uuid, uuid, text, text) from authenticated;
grant execute on function public.sign_requisition_receipt(uuid, uuid, text, text) to service_role;

commit;
