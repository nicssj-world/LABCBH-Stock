begin;

-- A partially received PR may be closed deliberately when the supplier will
-- not deliver the outstanding quantity. This is a terminal, audited state:
-- received_quantity and remaining_quantity stay truthful, while receiving is
-- disabled by the existing receivable-status allow-list.
alter table public.purchase_requests
  add column if not exists closed_short_by uuid references public.profiles(id) on delete restrict,
  add column if not exists closed_short_at timestamptz,
  add column if not exists closed_short_reason text;

alter table public.purchase_requests
  drop constraint if exists purchase_requests_status_check;

alter table public.purchase_requests
  add constraint purchase_requests_status_check check (status in (
    'draft',
    'pending',
    'completed',
    'partially_received',
    'received',
    'closed_short',
    'cancelled',
    'reversed'
  ));

alter table public.purchase_requests
  drop constraint if exists purchase_requests_acknowledgement_check;

alter table public.purchase_requests
  add constraint purchase_requests_acknowledgement_check check (
    (status in ('completed', 'partially_received', 'received', 'closed_short', 'reversed'))
      = (acknowledged_by is not null)
    and (acknowledged_by is null) = (acknowledged_at is null)
  );

alter table public.purchase_requests
  drop constraint if exists purchase_requests_short_close_audit_check;

alter table public.purchase_requests
  add constraint purchase_requests_short_close_audit_check check (
    (
      status = 'closed_short'
      and closed_short_by is not null
      and closed_short_at is not null
      and nullif(btrim(coalesce(closed_short_reason, '')), '') is not null
    )
    or (
      status <> 'closed_short'
      and closed_short_by is null
      and closed_short_at is null
      and closed_short_reason is null
    )
  );

create index if not exists purchase_requests_closed_short_by_idx
  on public.purchase_requests (closed_short_by)
  where closed_short_by is not null;

create or replace function public.close_purchase_request_remaining(
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
  closed_request public.purchase_requests%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '23514', message = 'closing remaining purchase request quantity requires a reason';
  end if;

  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if locked_request.status <> 'partially_received' then
    raise exception using
      errcode = '55000',
      message = format('purchase request is %s and cannot close remaining quantity', locked_request.status);
  end if;

  if not exists (
    select 1
    from public.goods_receipts receipt
    where receipt.purchase_request_id = p_pr_id
      and receipt.status = 'posted'
  ) then
    raise exception using errcode = '55000', message = 'only a partially received purchase request can close remaining quantity';
  end if;

  if not exists (
    select 1
    from public.purchase_request_items item
    where item.purchase_request_id = p_pr_id
      and item.remaining_quantity > 0
  ) then
    raise exception using errcode = '55000', message = 'purchase request has no remaining quantity to close';
  end if;

  if exists (
    select 1
    from public.goods_receipts receipt
    where receipt.purchase_request_id = p_pr_id
      and receipt.status = 'draft'
  ) then
    raise exception using errcode = '55000', message = 'cancel the open draft goods receipt before closing remaining quantity';
  end if;

  update public.purchase_requests
  set status = 'closed_short',
      closed_short_by = p_actor_id,
      closed_short_at = now(),
      closed_short_reason = btrim(p_reason),
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into closed_request;

  return closed_request;
end
$function$;

revoke execute on function public.close_purchase_request_remaining(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.close_purchase_request_remaining(uuid, uuid, text) to service_role;

commit;
