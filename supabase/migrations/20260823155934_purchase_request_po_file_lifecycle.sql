begin;

-- PO documents belong to the PR because the PO number and its evidence have
-- one lifecycle. The active object path is cleared at a terminal receiving
-- state, while these metadata columns remain as the PR audit trace.
alter table public.purchase_requests
  add column if not exists po_file_path text,
  add column if not exists po_file_name text,
  add column if not exists po_file_mime_type text,
  add column if not exists po_file_size_bytes bigint,
  add column if not exists po_file_checksum text,
  add column if not exists po_file_uploaded_by uuid references public.profiles(id) on delete restrict,
  add column if not exists po_file_uploaded_at timestamptz,
  add column if not exists po_file_deleted_by uuid references public.profiles(id) on delete restrict,
  add column if not exists po_file_deleted_at timestamptz,
  add column if not exists po_file_deletion_reason text,
  add column if not exists po_file_deleted_receipt_id uuid references public.goods_receipts(id) on delete set null;

alter table public.purchase_requests
  drop constraint if exists purchase_requests_po_file_size_check,
  drop constraint if exists purchase_requests_po_file_deletion_reason_check;

alter table public.purchase_requests
  add constraint purchase_requests_po_file_size_check check (
    po_file_size_bytes is null
    or po_file_size_bytes between 1 and 10485760
  ),
  add constraint purchase_requests_po_file_deletion_reason_check check (
    po_file_deletion_reason is null
    or po_file_deletion_reason in ('received', 'closed_short')
  );

create index if not exists purchase_requests_po_file_uploaded_by_idx
  on public.purchase_requests (po_file_uploaded_by)
  where po_file_uploaded_by is not null;
create index if not exists purchase_requests_po_file_deleted_by_idx
  on public.purchase_requests (po_file_deleted_by)
  where po_file_deleted_by is not null;
create index if not exists purchase_requests_po_file_deleted_receipt_idx
  on public.purchase_requests (po_file_deleted_receipt_id)
  where po_file_deleted_receipt_id is not null;

-- Keep the bucket private even when an older environment was provisioned with
-- a different bucket flag. There is intentionally no client delete policy.
insert into storage.buckets (id, name, public)
values ('lab-stock-po', 'lab-stock-po', false)
on conflict (id) do update set public = false;

create or replace function public.set_purchase_request_po_file(
  p_pr_id uuid,
  p_actor_id uuid,
  p_po_file_path text,
  p_file_name text,
  p_file_mime_type text,
  p_file_size_bytes bigint,
  p_file_checksum text
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  updated_request public.purchase_requests%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if locked_request.status not in ('completed', 'partially_received') then
    raise exception using
      errcode = '55000',
      message = 'PO file can only be attached to an open purchase request';
  end if;

  if nullif(btrim(coalesce(locked_request.po_number, '')), '') is null then
    raise exception using errcode = '23514', message = 'purchase request PO number is required';
  end if;

  if nullif(btrim(coalesce(p_po_file_path, '')), '') is null
     or p_po_file_path like '%..%'
     or p_po_file_path !~ format('^po/%s/%s/[^/]+$', locked_request.fiscal_year, p_pr_id) then
    raise exception using errcode = '23514', message = 'purchase request PO file path is invalid';
  end if;

  if nullif(btrim(coalesce(p_file_name, '')), '') is null then
    raise exception using errcode = '23514', message = 'purchase request PO file name is required';
  end if;

  if lower(btrim(coalesce(p_file_mime_type, ''))) not in (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  ) then
    raise exception using errcode = '22023', message = 'purchase request PO file type is not allowed';
  end if;

  if p_file_size_bytes is null or p_file_size_bytes not between 1 and 10485760 then
    raise exception using errcode = '22023', message = 'purchase request PO file size is not allowed';
  end if;

  if nullif(btrim(coalesce(p_file_checksum, '')), '') is null
     or p_file_checksum !~ '^[0-9a-fA-F]{64}$' then
    raise exception using errcode = '22023', message = 'purchase request PO file checksum is invalid';
  end if;

  update public.purchase_requests
  set po_file_path = btrim(p_po_file_path),
      po_file_name = btrim(p_file_name),
      po_file_mime_type = lower(btrim(p_file_mime_type)),
      po_file_size_bytes = p_file_size_bytes,
      po_file_checksum = lower(btrim(p_file_checksum)),
      po_file_uploaded_by = p_actor_id,
      po_file_uploaded_at = now(),
      po_file_deleted_by = null,
      po_file_deleted_at = null,
      po_file_deletion_reason = null,
      po_file_deleted_receipt_id = null,
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into updated_request;

  return updated_request;
end
$function$;

revoke execute on function public.set_purchase_request_po_file(uuid, uuid, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.set_purchase_request_po_file(uuid, uuid, text, text, text, bigint, text)
  to service_role;

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
  perform public.assert_stock_officer_actor(p_actor_id);

  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
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
    -- A retry after the audit was recorded is a no-op. If a terminal PR had no
    -- active file, still retain one explicit audit event for the cleanup job.
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

  -- Legacy receipt pointers are no longer needed after the server-side storage
  -- removal. Clearing them makes the cleanup set finite and retry-safe.
  update public.goods_receipts
  set po_image_path = null,
      updated_by = p_actor_id
  where purchase_request_id = p_pr_id
    and po_image_path is not null;

  return cleared_request;
end
$function$;

revoke execute on function public.clear_purchase_request_po_file(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.clear_purchase_request_po_file(uuid, uuid, text, uuid)
  to service_role;

-- Existing deployments stored the PO path on each receipt. Preserve the newest
-- pointer and its provenance in the PR audit record without deleting anything.
with latest_po as (
  select distinct on (receipt.purchase_request_id)
    receipt.purchase_request_id,
    receipt.po_image_path,
    receipt.received_by,
    receipt.created_by,
    receipt.created_at,
    case
      when lower(receipt.po_image_path) like '%.pdf' then 'application/pdf'
      when lower(receipt.po_image_path) like '%.png' then 'image/png'
      when lower(receipt.po_image_path) like '%.webp' then 'image/webp'
      when lower(receipt.po_image_path) like '%.jpg'
        or lower(receipt.po_image_path) like '%.jpeg' then 'image/jpeg'
      else null
    end as inferred_mime_type
  from public.goods_receipts receipt
  where receipt.purchase_request_id is not null
    and receipt.po_image_path is not null
  order by receipt.purchase_request_id, receipt.received_date desc, receipt.created_at desc
)
update public.purchase_requests request
set po_file_path = latest_po.po_image_path,
    po_file_name = split_part(latest_po.po_image_path, '/', 4),
    po_file_mime_type = latest_po.inferred_mime_type,
    po_file_uploaded_by = coalesce(latest_po.received_by, latest_po.created_by),
    po_file_uploaded_at = latest_po.created_at
from latest_po
where request.id = latest_po.purchase_request_id
  and request.po_file_path is null;

-- Receipt creation derives the PO snapshot from the locked PR. A client may no
-- longer smuggle a different PO number into a receipt header.
create or replace function public.create_goods_receipt(
  p_actor_id uuid,
  p_receipt jsonb,
  p_items jsonb
)
returns public.goods_receipts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_receipt public.goods_receipts%rowtype;
  locked_request public.purchase_requests%rowtype;
  parsed_received_date date;
  parsed_purchase_request_id uuid;
  line jsonb;
  line_index integer := 0;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object' then
    raise exception using errcode = '22023', message = 'goods receipt payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_receipt) field_name
    where field_name not in (
      'purchaseRequestId', 'department', 'receivedDate', 'receiverName', 'note'
    )
  ) then
    raise exception using errcode = '22023', message = 'unexpected goods receipt field';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'goods receipt must have at least one line';
  end if;

  parsed_received_date := (p_receipt ->> 'receivedDate')::date;
  parsed_purchase_request_id := nullif(p_receipt ->> 'purchaseRequestId', '')::uuid;

  if parsed_purchase_request_id is not null then
    select *
    into locked_request
    from public.purchase_requests request
    where request.id = parsed_purchase_request_id
    for update;

    if not found then
      raise exception using errcode = '23503', message = 'purchase request not found';
    end if;

    if locked_request.status not in ('completed', 'partially_received') then
      raise exception using
        errcode = '55000',
        message = 'only a confirmed or partially received purchase request can be received';
    end if;

    if coalesce(locked_request.purchase_method, '') not in (
      'annual_plan', 'contract', 'awaiting_contract', 'off_plan'
    ) then
      raise exception using errcode = '55000', message = 'this purchase request is not receivable against a purchase order';
    end if;

    if locked_request.department is distinct from btrim(p_receipt ->> 'department') then
      raise exception using errcode = '42501', message = 'purchase request belongs to a different department';
    end if;

    if exists (
      select 1
      from public.goods_receipts receipt
      where receipt.purchase_request_id = parsed_purchase_request_id
        and receipt.status = 'draft'
    ) then
      raise exception using errcode = '55000', message = 'purchase request already has an open draft goods receipt';
    end if;

    update public.purchase_request_items pr_item
    set received_quantity = coalesce((
      select sum(receipt_item.quantity)
      from public.goods_receipts receipt
      join public.goods_receipt_items receipt_item
        on receipt_item.goods_receipt_id = receipt.id
      where receipt.purchase_request_id = parsed_purchase_request_id
        and receipt.status = 'posted'
        and receipt_item.inventory_item_id = pr_item.inventory_item_id
    ), 0)
    where pr_item.purchase_request_id = parsed_purchase_request_id;

    if exists (
      select 1
      from (
        select
          (item ->> 'inventoryItemId')::uuid as inventory_item_id,
          sum((item ->> 'quantity')::numeric) as total_quantity
        from jsonb_array_elements(p_items) item
        group by (item ->> 'inventoryItemId')::uuid
      ) totals
      left join public.purchase_request_items pr_item
        on pr_item.purchase_request_id = parsed_purchase_request_id
       and pr_item.inventory_item_id = totals.inventory_item_id
      where pr_item.id is null
         or totals.total_quantity > pr_item.remaining_quantity
    ) then
      raise exception using
        errcode = '23514',
        message = 'received items and quantities exceed the purchase request remaining quantity';
    end if;
  end if;

  insert into public.goods_receipts (
    fiscal_year,
    purchase_request_id,
    po_number,
    department,
    received_date,
    receiver_name,
    received_by,
    status,
    note,
    created_by,
    updated_by
  )
  values (
    extract(year from parsed_received_date)::integer + 543
      + case when extract(month from parsed_received_date) >= 10 then 1 else 0 end,
    parsed_purchase_request_id,
    case
      when parsed_purchase_request_id is not null then nullif(btrim(locked_request.po_number), '')
      else null
    end,
    btrim(p_receipt ->> 'department'),
    parsed_received_date,
    btrim(p_receipt ->> 'receiverName'),
    p_actor_id,
    'draft',
    nullif(btrim(coalesce(p_receipt ->> 'note', '')), ''),
    p_actor_id,
    p_actor_id
  )
  returning * into created_receipt;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_index := line_index + 1;

    insert into public.goods_receipt_items (
      goods_receipt_id,
      line_number,
      inventory_item_id,
      lot_number,
      expiry_date,
      quantity,
      unit,
      storage_location
    )
    values (
      created_receipt.id,
      line_index,
      (line ->> 'inventoryItemId')::uuid,
      btrim(line ->> 'lotNumber'),
      nullif(line ->> 'expiryDate', '')::date,
      (line ->> 'quantity')::numeric,
      btrim(line ->> 'unit'),
      nullif(btrim(coalesce(line ->> 'storageLocation', '')), '')
    );
  end loop;

  return created_receipt;
end
$function$;

revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_goods_receipt(uuid, jsonb, jsonb)
  to service_role;

commit;
