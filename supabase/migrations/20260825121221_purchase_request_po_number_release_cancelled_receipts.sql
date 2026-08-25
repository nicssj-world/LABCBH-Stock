begin;

-- The original PO release migration treated any receipt history as active.
-- A cancelled draft has no stock effect, so preserve it for audit while
-- allowing the PO number to be released when no active receipt remains.
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

  if locked_request.po_file_uploaded_at is not null then
    raise exception using
      errcode = '55000',
      message = 'cannot release a purchase order number after a PO file was attached';
  end if;

  if exists (
    select 1
    from public.goods_receipts receipt
    where receipt.purchase_request_id = p_pr_id
      and receipt.status <> 'cancelled'
  ) then
    raise exception using
      errcode = '55000',
      message = 'cannot release a purchase order number while a goods receipt is active';
  end if;

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
