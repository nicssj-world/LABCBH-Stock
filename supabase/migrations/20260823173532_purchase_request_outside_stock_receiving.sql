begin;

-- A department may receive an issued PO itself without sending the goods
-- through the laboratory warehouse. Keep that operational closure separate
-- from quantities proven by posted goods receipts so the stock ledger remains
-- truthful while the PR can still reach its terminal received state.
alter table public.purchase_requests
  add column if not exists outside_stock_received_by uuid references public.profiles(id) on delete restrict,
  add column if not exists outside_stock_received_at timestamptz,
  add column if not exists outside_stock_received_note text;

alter table public.purchase_requests
  drop constraint if exists purchase_requests_outside_stock_receipt_audit_check;

alter table public.purchase_requests
  add constraint purchase_requests_outside_stock_receipt_audit_check check (
    (
      outside_stock_received_by is null
      and outside_stock_received_at is null
      and outside_stock_received_note is null
    )
    or (
      status = 'received'
      and outside_stock_received_by is not null
      and outside_stock_received_at is not null
      and outside_stock_received_note = 'หน่วยงานรับของเอง'
    )
  );

create index if not exists purchase_requests_outside_stock_received_by_idx
  on public.purchase_requests (outside_stock_received_by)
  where outside_stock_received_by is not null;

create or replace function public.mark_purchase_request_received_outside_stock(
  p_pr_id uuid,
  p_actor_id uuid
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  received_request public.purchase_requests%rowtype;
begin
  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  perform public.assert_purchase_request_manager(p_actor_id, locked_request.requester_id);

  -- Two sessions may confirm the same terminal action. Once the first one has
  -- recorded this exact workflow, the second call is a safe no-op. A PR that
  -- reached received through a posted warehouse receipt has no audit timestamp
  -- here and therefore continues to the status error below.
  if locked_request.status = 'received'
     and locked_request.outside_stock_received_at is not null then
    return locked_request;
  end if;

  if locked_request.status <> 'completed' then
    raise exception using
      errcode = '55000',
      message = 'only a confirmed purchase request can be received outside stock';
  end if;

  if locked_request.purchase_method not in (
    'annual_plan', 'contract', 'awaiting_contract', 'off_plan'
  ) then
    raise exception using
      errcode = '55000',
      message = 'only a purchase-order request can be received outside stock';
  end if;

  if exists (
    select 1
    from public.goods_receipts receipt
    where receipt.purchase_request_id = p_pr_id
      and receipt.status in ('draft', 'posted')
  ) then
    raise exception using
      errcode = '55000',
      message = 'cancel the open or posted goods receipt before receiving outside stock';
  end if;

  update public.purchase_requests
  set status = 'received',
      outside_stock_received_by = p_actor_id,
      outside_stock_received_at = now(),
      outside_stock_received_note = 'หน่วยงานรับของเอง',
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into received_request;

  return received_request;
end
$function$;

revoke execute on function public.mark_purchase_request_received_outside_stock(uuid, uuid) from public;
revoke execute on function public.mark_purchase_request_received_outside_stock(uuid, uuid) from anon;
revoke execute on function public.mark_purchase_request_received_outside_stock(uuid, uuid) from authenticated;
grant execute on function public.mark_purchase_request_received_outside_stock(uuid, uuid) to service_role;

-- Terminal PO cleanup normally belongs to stock officers. When the terminal
-- state was created by the outside-stock workflow, the same requester who was
-- authorized to close the PR must also be able to finish or retry cleanup.
create or replace function public.clear_purchase_request_po_file(
  p_pr_id uuid,
  p_actor_id uuid,
  p_deletion_reason text,
  p_receipt_id uuid default null
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  cleared_request public.purchase_requests%rowtype;
begin
  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if locked_request.outside_stock_received_at is not null then
    perform public.assert_purchase_request_manager(p_actor_id, locked_request.requester_id);
  else
    perform public.assert_stock_officer_actor(p_actor_id);
  end if;

  if locked_request.status not in ('received', 'closed_short') then
    raise exception using
      errcode = '55000',
      message = 'PO file can only be cleared from a terminal purchase request';
  end if;

  if p_deletion_reason not in ('received', 'closed_short')
     or p_deletion_reason <> locked_request.status then
    raise exception using errcode = '22023', message = 'invalid PO file deletion reason';
  end if;

  if p_receipt_id is not null and not exists (
    select 1
    from public.goods_receipts receipt
    where receipt.id = p_receipt_id
      and receipt.purchase_request_id = p_pr_id
      and receipt.status = 'posted'
  ) then
    raise exception using errcode = '23503', message = 'triggering goods receipt is not linked and posted';
  end if;

  if locked_request.po_file_path is not null and locked_request.po_file_deleted_at is null then
    update public.purchase_requests
    set po_file_path = null,
        po_file_deleted_by = p_actor_id,
        po_file_deleted_at = now(),
        po_file_deletion_reason = p_deletion_reason,
        po_file_deleted_receipt_id = p_receipt_id,
        updated_by = p_actor_id
    where id = p_pr_id
    returning * into cleared_request;
  else
    if locked_request.po_file_deleted_at is null then
      update public.purchase_requests
      set po_file_path = null,
          po_file_deleted_by = p_actor_id,
          po_file_deleted_at = now(),
          po_file_deletion_reason = p_deletion_reason,
          po_file_deleted_receipt_id = p_receipt_id,
          updated_by = p_actor_id
      where id = p_pr_id
      returning * into cleared_request;
    else
      cleared_request := locked_request;
    end if;
  end if;

  update public.goods_receipts
  set po_image_path = null,
      updated_by = p_actor_id
  where purchase_request_id = p_pr_id
    and po_image_path is not null;

  return cleared_request;
end
$function$;

revoke execute on function public.clear_purchase_request_po_file(uuid, uuid, text, uuid) from public;
revoke execute on function public.clear_purchase_request_po_file(uuid, uuid, text, uuid) from anon;
revoke execute on function public.clear_purchase_request_po_file(uuid, uuid, text, uuid) from authenticated;
grant execute on function public.clear_purchase_request_po_file(uuid, uuid, text, uuid) to service_role;

commit;
