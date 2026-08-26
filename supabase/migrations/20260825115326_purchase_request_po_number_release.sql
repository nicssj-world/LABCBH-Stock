begin;

-- A cancelled PR keeps its PO number as an audit fact. Releasing the number
-- only removes it from the active uniqueness set; it never erases the number,
-- actor, timestamp, or reason from the cancelled PR.
alter table public.purchase_requests
  add column if not exists po_number_released_by uuid,
  add column if not exists po_number_released_at timestamptz,
  add column if not exists po_number_release_reason text;

alter table public.purchase_requests
  add constraint purchase_requests_po_number_released_by_fkey
  foreign key (po_number_released_by)
  references public.profiles(id)
  on delete restrict;

alter table public.purchase_requests
  drop constraint if exists purchase_requests_po_number_release_check;

alter table public.purchase_requests
  add constraint purchase_requests_po_number_release_check check (
    (
      po_number_released_at is null
      and po_number_released_by is null
      and po_number_release_reason is null
    )
    or (
      po_number_released_at is not null
      and po_number_released_by is not null
      and nullif(btrim(po_number_release_reason), '') is not null
    )
  );

drop index if exists public.purchase_requests_po_number_key;
create unique index if not exists purchase_requests_po_number_key
  on public.purchase_requests (lower(btrim(po_number)))
  where po_number is not null
    and po_number_released_at is null;

create index if not exists purchase_requests_po_number_released_by_idx
  on public.purchase_requests (po_number_released_by)
  where po_number_released_by is not null;

create or replace function public.release_purchase_order_number(
  p_pr_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  released_request public.purchase_requests%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using
      errcode = '23514',
      message = 'releasing a purchase order number requires a reason';
  end if;

  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if locked_request.status not in ('cancelled', 'reversed') then
    raise exception using
      errcode = '55000',
      message = 'only a cancelled or reversed purchase request can release its purchase order number';
  end if;

  if nullif(btrim(coalesce(locked_request.po_number, '')), '') is null then
    raise exception using errcode = '55000', message = 'purchase request has no purchase order number to release';
  end if;

  if locked_request.po_number_released_at is not null then
    raise exception using errcode = '55000', message = 'purchase order number has already been released';
  end if;

  -- A file is evidence that a PO was actually issued, even if the active
  -- object was later cleaned up. It must remain permanently tied to this PR.
  if locked_request.po_file_uploaded_at is not null then
    raise exception using
      errcode = '55000',
      message = 'cannot release a purchase order number after a PO file was attached';
  end if;

  -- Any receipt row, including a cancelled draft, means the number entered a
  -- receiving workflow and must remain reserved for auditability.
  if exists (
    select 1
    from public.goods_receipts receipt
    where receipt.purchase_request_id = p_pr_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'cannot release a purchase order number after a goods receipt was created';
  end if;

  -- LINE attempts are external side effects. Failed or unknown attempts are
  -- retained too, so a later retry cannot make the same PO ambiguous.
  if exists (
    select 1
    from public.purchase_request_line_notifications notification
    where notification.purchase_request_id = p_pr_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'cannot release a purchase order number after a LINE notification was attempted';
  end if;

  update public.purchase_requests
  set po_number_released_by = p_actor_id,
      po_number_released_at = now(),
      po_number_release_reason = btrim(p_reason),
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into released_request;

  return released_request;
end
$function$;

revoke execute on function public.release_purchase_order_number(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_purchase_order_number(uuid, uuid, text)
  to service_role;

commit;
