-- Requisition workflow: allow an audited short issue, add an explicit receipt
-- state, and let a receiver save a drawn signature into the shared Portal
-- profile before confirming the receipt.
--
-- Fulfilment still owns the immutable stock issue. Receipt confirmation only
-- records proof that the goods were accepted.

begin;

alter table public.requisitions
  add column if not exists received_by uuid references public.profiles(id) on delete restrict;

alter table public.requisition_items
  add column if not exists short_issue_reason text;

-- The profile row and signature bucket are shared with Lab Management Portal.
-- Keep the additions idempotent so this migration is safe whether the Portal's
-- document-profile migration has already run or not.
alter table public.profiles
  add column if not exists signature_url text,
  add column if not exists signature_updated_at timestamptz,
  add column if not exists signature_updated_by uuid references public.profiles(id) on delete set null;

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false)
on conflict (id) do update set public = false;

update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/png']
where id = 'signatures';

-- Only trusted server actions may access the signature objects. There is no
-- browser policy, so the private bucket cannot be read or written directly.
drop policy if exists lab_stock_signatures_service_role on storage.objects;
create policy lab_stock_signatures_service_role
on storage.objects for all
to service_role
using (bucket_id = 'signatures')
with check (bucket_id = 'signatures');

create index if not exists requisitions_received_by_idx
  on public.requisitions (received_by) where received_by is not null;

-- The inline status check in the base migration is named by PostgreSQL from
-- the table and column. Rebuild it forward-only so old rows remain valid while
-- receipt becomes a separate terminal state.
alter table public.requisitions
  drop constraint if exists requisitions_status_check;

alter table public.requisitions
  add constraint requisitions_status_check check (
    status in ('waiting', 'fulfilled', 'received', 'cancelled')
  );

alter table public.requisitions
  drop constraint if exists requisitions_fulfilled_check;

alter table public.requisitions
  add constraint requisitions_fulfilled_check check (
    (status in ('fulfilled', 'received')) = (fulfilled_at is not null)
    and (fulfilled_at is null) = (fulfilled_by is null)
  );

-- Replace the previous fulfilled-only audit guard before the backfill below.
-- Otherwise changing a historical row from fulfilled to received would make
-- the old constraint see audit data on a non-fulfilled row and reject the
-- update before the new received-aware constraint can be installed.
alter table public.requisitions
  drop constraint if exists requisitions_fulfilled_audit_check;

alter table public.requisitions
  add constraint requisitions_fulfilled_audit_check check (
    (status in ('fulfilled', 'received')) = (
      fulfilled_at is not null
      and fulfilled_by is not null
      and nullif(btrim(fulfilled_by_name), '') is not null
    )
  );

-- Historical rows that already contain the old receipt proof are already
-- received in substance. Preserve their evidence and do not invent a receiver
-- profile id when the old flow did not record one.
update public.requisitions as requisition
set status = 'received'
where requisition.status = 'fulfilled'
  and requisition.signed_at is not null
  and requisition.signature is not null
  and nullif(btrim(requisition.received_by_name), '') is not null;

alter table public.requisitions
  drop constraint if exists requisitions_signed_check;

alter table public.requisitions
  drop constraint if exists requisitions_receipt_check;

alter table public.requisitions
  add constraint requisitions_receipt_check check (
    (status = 'received') = (
      signed_at is not null
      and nullif(btrim(signature), '') is not null
      and nullif(btrim(received_by_name), '') is not null
    )
    and (signed_at is not null) = (nullif(btrim(signature), '') is not null)
    and (signed_at is not null) = (nullif(btrim(received_by_name), '') is not null)
  );

-- A fulfilled line is either a full issue with no short-issue reason, or a
-- positive partial issue with one non-empty reason. Waiting lines carry neither.
alter table public.requisition_items
  drop constraint if exists requisition_items_fulfilled_quantity_check;

alter table public.requisition_items
  drop constraint if exists requisition_items_fulfillment_check;

alter table public.requisition_items
  add constraint requisition_items_fulfillment_check check (
    (fulfilled_quantity is null and short_issue_reason is null)
    or (
      fulfilled_quantity > 0
      and fulfilled_quantity <= requested_quantity
      and (
        (
          fulfilled_quantity < requested_quantity
          and nullif(btrim(short_issue_reason), '') is not null
          and char_length(btrim(short_issue_reason)) <= 500
        )
        or (
          fulfilled_quantity = requested_quantity
          and short_issue_reason is null
        )
      )
    )
  );

-- Reapply fulfilment with short-issue validation while retaining the latest
-- reservation-aware lock order, FIFO guard, expiry guard, and issue ledger.
create or replace function public.fulfill_requisition(
  p_requisition_id uuid,
  p_actor_id uuid,
  p_allocations jsonb
)
returns public.requisitions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  row_locked_requisition public.requisitions%rowtype;
  row_fulfilled_requisition public.requisitions%rowtype;
  row_line public.requisition_items%rowtype;
  payload_allocation jsonb;
  row_locked_lot public.inventory_lots%rowtype;
  v_allocated_total numeric(15,3);
  v_allocation_quantity numeric(15,3);
  v_override_reason text;
  v_short_issue_reason text;
  v_line_short_issue_reason text;
  v_seen_short_issue_reason boolean;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  select requisition.*
  into row_locked_requisition
  from public.requisitions as requisition
  where requisition.id = p_requisition_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'requisition not found';
  end if;

  if row_locked_requisition.status <> 'waiting' then
    raise exception using
      errcode = '55000',
      message = format('requisition is %s and cannot be fulfilled', row_locked_requisition.status);
  end if;

  if p_allocations is null
     or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) = 0 then
    raise exception using errcode = '22023', message = 'allocations must be a non-empty array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_allocations) as allocation_entry(value)
    where not exists (
      select 1
      from public.requisition_items as item
      where item.id = (allocation_entry.value ->> 'requisitionItemId')::uuid
        and item.requisition_id = row_locked_requisition.id
    )
  ) then
    raise exception using errcode = '23503', message = 'allocation contains an item outside this requisition';
  end if;

  perform 1
  from public.inventory_items as catalogue
  where catalogue.id in (
    select item.inventory_item_id
    from public.requisition_items as item
    where item.requisition_id = row_locked_requisition.id
  )
  order by catalogue.id
  for update;

  for row_line in
    select item.*
    from public.requisition_items as item
    where item.requisition_id = p_requisition_id
    order by item.line_number
  loop
    perform public.assert_requisition_fifo(row_line.id, p_allocations);
    v_allocated_total := 0;
    v_line_short_issue_reason := null;
    v_seen_short_issue_reason := false;

    for payload_allocation in
      select allocation_entry.value
      from jsonb_array_elements(p_allocations) as allocation_entry(value)
      where (allocation_entry.value ->> 'requisitionItemId')::uuid = row_line.id
    loop
      v_allocation_quantity := nullif(payload_allocation ->> 'quantity', '')::numeric;
      v_override_reason := nullif(btrim(coalesce(payload_allocation ->> 'overrideReason', '')), '');
      v_short_issue_reason := nullif(btrim(coalesce(payload_allocation ->> 'shortIssueReason', '')), '');

      if not v_seen_short_issue_reason then
        v_line_short_issue_reason := v_short_issue_reason;
        v_seen_short_issue_reason := true;
      elsif v_line_short_issue_reason is distinct from v_short_issue_reason then
        raise exception using
          errcode = '22023',
          message = 'all allocations for one requisition item must use the same short-issue reason';
      end if;

      if v_allocation_quantity is null or v_allocation_quantity <= 0 then
        raise exception using errcode = '23514', message = 'allocation quantity must be positive';
      end if;

      select lot.*
      into row_locked_lot
      from public.inventory_lots as lot
      where lot.id = (payload_allocation ->> 'inventoryLotId')::uuid
      for update;

      if not found then
        raise exception using errcode = '23503', message = 'inventory lot not found';
      end if;

      if row_locked_lot.inventory_item_id <> row_line.inventory_item_id then
        raise exception using
          errcode = '23514',
          message = 'lot belongs to a different inventory item';
      end if;

      if row_locked_lot.expiry_date is not null
         and row_locked_lot.expiry_date <= public.lab_stock_today() then
        raise exception using
          errcode = '23514',
          message = format('expired lot cannot be issued (%s)', row_locked_lot.lot_number);
      end if;

      insert into public.requisition_lot_allocations (
        requisition_item_id,
        inventory_lot_id,
        quantity,
        is_fifo_override,
        override_reason,
        created_by
      )
      values (
        row_line.id,
        row_locked_lot.id,
        v_allocation_quantity,
        v_override_reason is not null,
        v_override_reason,
        p_actor_id
      );

      insert into public.stock_movements (
        inventory_item_id,
        inventory_lot_id,
        movement_type,
        quantity,
        occurred_on,
        source_document_type,
        source_document_id,
        note,
        created_by
      )
      values (
        row_line.inventory_item_id,
        row_locked_lot.id,
        'requisition_issue',
        -v_allocation_quantity,
        public.lab_stock_today(),
        'requisition',
        p_requisition_id,
        coalesce(v_override_reason, v_short_issue_reason),
        p_actor_id
      );

      v_allocated_total := v_allocated_total + v_allocation_quantity;
    end loop;

    if v_allocated_total <= 0 then
      raise exception using
        errcode = '23514',
        message = format('requisition item %s must receive a positive quantity', row_line.line_number);
    end if;

    if v_allocated_total > row_line.requested_quantity then
      raise exception using
        errcode = '23514',
        message = format(
          'fulfilled quantity %s exceeds requested quantity %s',
          v_allocated_total,
          row_line.requested_quantity
        );
    end if;

    if v_allocated_total < row_line.requested_quantity
       and nullif(btrim(v_line_short_issue_reason), '') is null then
      raise exception using
        errcode = '23514',
        message = 'a short issue requires a reason';
    end if;

    if v_allocated_total = row_line.requested_quantity
       and v_line_short_issue_reason is not null then
      raise exception using
        errcode = '23514',
        message = 'a full issue must not contain a short-issue reason';
    end if;

    if v_line_short_issue_reason is not null
       and char_length(v_line_short_issue_reason) > 500 then
      raise exception using
        errcode = '22023',
        message = 'short-issue reason must not exceed 500 characters';
    end if;

    update public.requisition_items as item
    set fulfilled_quantity = v_allocated_total,
        short_issue_reason = v_line_short_issue_reason
    where item.id = row_line.id;
  end loop;

  update public.requisitions as requisition
  set status = 'fulfilled',
      fulfilled_by = p_actor_id,
      fulfilled_at = now(),
      updated_by = p_actor_id
  where requisition.id = p_requisition_id
  returning requisition.* into row_fulfilled_requisition;

  return row_fulfilled_requisition;
end
$function$;

revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from public;
revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from anon;
revoke execute on function public.fulfill_requisition(uuid, uuid, jsonb) from authenticated;
grant execute on function public.fulfill_requisition(uuid, uuid, jsonb) to service_role;

-- Retire the pre-Portal signature RPC. Keeping it callable would allow a
-- stale server action to write proof without the requester/stock boundary and
-- without advancing the explicit receipt status.
revoke execute on function public.sign_requisition_receipt(uuid, uuid, text, text) from public;
revoke execute on function public.sign_requisition_receipt(uuid, uuid, text, text) from anon;
revoke execute on function public.sign_requisition_receipt(uuid, uuid, text, text) from authenticated;
revoke execute on function public.sign_requisition_receipt(uuid, uuid, text, text) from service_role;

-- Save a drawn PNG into the same shared private profile source used by the
-- Lab Management Portal. Storage is uploaded by the server action; this RPC is
-- the only database write for the profile row and creates the audit event.
create or replace function public.save_profile_signature(
  p_actor_id uuid,
  p_signature_path text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_signature_path text;
  v_previous_signature_path text;
  v_profile_status text;
  v_profile_deleted_at timestamptz;
begin
  v_signature_path := nullif(btrim(coalesce(p_signature_path, '')), '');

  if p_actor_id is null then
    raise exception using errcode = '22023', message = 'actor id is required';
  end if;

  if v_signature_path is null or v_signature_path <> p_actor_id::text || '.png' then
    raise exception using errcode = '22023', message = 'signature path is not allowed';
  end if;

  select profile.signature_url, profile.status, profile.deleted_at
  into v_previous_signature_path, v_profile_status, v_profile_deleted_at
  from public.profiles as profile
  where profile.id = p_actor_id
  for update;

  if not found or v_profile_status <> 'active' or v_profile_deleted_at is not null then
    raise exception using errcode = '42501', message = 'actor profile is not active';
  end if;

  update public.profiles as profile
  set signature_url = v_signature_path,
      signature_updated_at = now(),
      signature_updated_by = p_actor_id
  where profile.id = p_actor_id;

  insert into public.audit_log(action, user_id, target, detail)
  values (
    'requisition.receipt_signature_drawn',
    p_actor_id,
    p_actor_id::text,
    jsonb_build_object(
      'source', 'requisition_receipt',
      'signature_path', v_signature_path
    )::text
  );

  return jsonb_build_object(
    'id', p_actor_id,
    'signature_url', v_signature_path,
    'previous_signature_path', v_previous_signature_path
  );
end
$function$;

revoke execute on function public.save_profile_signature(uuid, text) from public;
revoke execute on function public.save_profile_signature(uuid, text) from anon;
revoke execute on function public.save_profile_signature(uuid, text) from authenticated;
grant execute on function public.save_profile_signature(uuid, text) to service_role;

-- Receipt confirmation records the actor's profile name and immutable PNG
-- snapshot. The old sign_requisition_receipt function is left in place for
-- migration compatibility, but the receipt constraint makes its old fulfilled
-- update path fail until the new workflow is used.
create or replace function public.receive_requisition(
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
  row_locked_requisition public.requisitions%rowtype;
  row_received_requisition public.requisitions%rowtype;
  v_received_by_name text;
  v_signature text;
begin
  v_received_by_name := nullif(btrim(coalesce(p_received_by_name, '')), '');
  v_signature := nullif(btrim(coalesce(p_signature, '')), '');

  if v_received_by_name is null then
    raise exception using errcode = '23502', message = 'receiver name is required';
  end if;

  if v_signature is null then
    raise exception using errcode = '23502', message = 'signature is required';
  end if;

  if left(v_signature, 22) <> 'data:image/png;base64,' then
    raise exception using errcode = '22023', message = 'signature must be a PNG data URI';
  end if;

  if char_length(v_signature) > 500000 then
    raise exception using errcode = '22023', message = 'signature is too large';
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
      signature = v_signature,
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
      'received_by_name', row_received_requisition.received_by_name
    )::text
  );

  return row_received_requisition;
end
$function$;

revoke execute on function public.receive_requisition(uuid, uuid, text, text) from public;
revoke execute on function public.receive_requisition(uuid, uuid, text, text) from anon;
revoke execute on function public.receive_requisition(uuid, uuid, text, text) from authenticated;
grant execute on function public.receive_requisition(uuid, uuid, text, text) to service_role;

commit;
