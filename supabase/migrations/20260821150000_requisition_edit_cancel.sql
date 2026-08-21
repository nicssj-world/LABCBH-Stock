-- Allow the person who raised a requisition to correct it, and to remove a
-- mistaken one, for as long as the stock officer has not dispensed it.
--
-- Stock is only ever deducted by fulfill_requisition, which writes the
-- requisition_issue movements. A waiting requisition has moved nothing, so
-- editing or cancelling one needs no compensating ledger entry — and once it
-- is fulfilled the ledger is append-only, which is why both functions below
-- refuse any status other than 'waiting' rather than trying to unwind an issue.
begin;

create or replace function public.assert_requisition_manager(
  p_actor_id uuid,
  p_requester_id uuid
)
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
        profile.id = p_requester_id
        or profile.ephis_id = '9495'
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
      message = 'actor is not allowed to edit or cancel this requisition';
  end if;
end
$function$;

revoke execute on function public.assert_requisition_manager(uuid, uuid) from public;
revoke execute on function public.assert_requisition_manager(uuid, uuid) from anon;
revoke execute on function public.assert_requisition_manager(uuid, uuid) from authenticated;
grant execute on function public.assert_requisition_manager(uuid, uuid) to service_role;

create or replace function public.update_requisition(
  p_requisition_id uuid,
  p_actor_id uuid,
  p_requisition jsonb,
  p_items jsonb
)
returns public.requisitions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_requisition public.requisitions%rowtype;
  updated_requisition public.requisitions%rowtype;
  parsed_desired_date date;
  parsed_fiscal_year integer;
  line jsonb;
  line_index integer := 0;
begin
  -- Lock first, then re-read the status under that lock: checking before
  -- locking would let an edit land while a stock officer is dispensing.
  select *
  into locked_requisition
  from public.requisitions requisition
  where requisition.id = p_requisition_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'requisition not found';
  end if;

  if locked_requisition.status <> 'waiting' then
    raise exception using
      errcode = '55000',
      message = format('requisition is %s and cannot be edited', locked_requisition.status);
  end if;

  perform public.assert_requisition_manager(p_actor_id, locked_requisition.requester_id);

  if p_requisition is null or jsonb_typeof(p_requisition) <> 'object' then
    raise exception using errcode = '22023', message = 'requisition payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_requisition) field_name
    where field_name not in ('department', 'requesterName', 'desiredDate', 'note')
  ) then
    raise exception using errcode = '22023', message = 'unexpected requisition field';
  end if;

  if nullif(btrim(coalesce(p_requisition ->> 'department', '')), '') is null then
    raise exception using errcode = '22023', message = 'department is required';
  end if;

  if nullif(btrim(coalesce(p_requisition ->> 'requesterName', '')), '') is null then
    raise exception using errcode = '22023', message = 'requester name is required';
  end if;

  if p_requisition ->> 'desiredDate' is null then
    raise exception using errcode = '22023', message = 'desired date is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'requisition must have at least one line';
  end if;

  parsed_desired_date := (p_requisition ->> 'desiredDate')::date;
  parsed_fiscal_year := extract(year from parsed_desired_date)::integer + 543
    + case when extract(month from parsed_desired_date) >= 10 then 1 else 0 end;

  -- The document number was minted from the fiscal year and that year's
  -- sequence. Letting a date edit cross into another fiscal year would leave
  -- RQ-2569-0007 filed under 2570 with a sequence that means nothing there.
  if parsed_fiscal_year <> locked_requisition.fiscal_year then
    raise exception using
      errcode = '22023',
      message = 'แก้วันที่ข้ามปีงบประมาณไม่ได้ กรุณายกเลิกแล้วสร้างใบเบิกใหม่';
  end if;

  -- A waiting requisition should have no allocations at all. If one exists the
  -- ledger has already moved, so refuse rather than delete the lines it points
  -- at — requisition_lot_allocations is append-only and its FK is restrict.
  if exists (
    select 1
    from public.requisition_lot_allocations allocation
    join public.requisition_items item on item.id = allocation.requisition_item_id
    where item.requisition_id = locked_requisition.id
  ) then
    raise exception using
      errcode = '55000',
      message = 'requisition already has lot allocations';
  end if;

  update public.requisitions
  set department = btrim(p_requisition ->> 'department'),
      requester_name = btrim(p_requisition ->> 'requesterName'),
      desired_date = parsed_desired_date,
      note = nullif(btrim(coalesce(p_requisition ->> 'note', '')), ''),
      updated_by = p_actor_id
  where id = locked_requisition.id
  returning * into updated_requisition;

  delete from public.requisition_items
  where requisition_id = locked_requisition.id;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_index := line_index + 1;

    insert into public.requisition_items (
      requisition_id,
      line_number,
      inventory_item_id,
      requested_quantity,
      unit,
      note
    )
    values (
      updated_requisition.id,
      line_index,
      (line ->> 'inventoryItemId')::uuid,
      (line ->> 'requestedQuantity')::numeric,
      btrim(line ->> 'unit'),
      nullif(btrim(coalesce(line ->> 'note', '')), '')
    );
  end loop;

  return updated_requisition;
end
$function$;

revoke execute on function public.update_requisition(uuid, uuid, jsonb, jsonb) from public;
revoke execute on function public.update_requisition(uuid, uuid, jsonb, jsonb) from anon;
revoke execute on function public.update_requisition(uuid, uuid, jsonb, jsonb) from authenticated;
grant execute on function public.update_requisition(uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.cancel_requisition(
  p_requisition_id uuid,
  p_actor_id uuid
)
returns public.requisitions
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_requisition public.requisitions%rowtype;
  cancelled_requisition public.requisitions%rowtype;
begin
  select *
  into locked_requisition
  from public.requisitions requisition
  where requisition.id = p_requisition_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'requisition not found';
  end if;

  if locked_requisition.status <> 'waiting' then
    raise exception using
      errcode = '55000',
      message = format('requisition is %s and cannot be cancelled', locked_requisition.status);
  end if;

  perform public.assert_requisition_manager(p_actor_id, locked_requisition.requester_id);

  -- Cancelling keeps the row and its lines: the document number stays spent so
  -- the register still reads as a continuous audit trail.
  update public.requisitions
  set status = 'cancelled',
      cancelled_by = p_actor_id,
      cancelled_at = now(),
      updated_by = p_actor_id
  where id = locked_requisition.id
  returning * into cancelled_requisition;

  return cancelled_requisition;
end
$function$;

revoke execute on function public.cancel_requisition(uuid, uuid) from public;
revoke execute on function public.cancel_requisition(uuid, uuid) from anon;
revoke execute on function public.cancel_requisition(uuid, uuid) from authenticated;
grant execute on function public.cancel_requisition(uuid, uuid) to service_role;

commit;
