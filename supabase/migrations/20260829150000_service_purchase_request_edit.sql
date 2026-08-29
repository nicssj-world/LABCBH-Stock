-- Full edits for a pending service PR. The request row and its reservation are
-- changed in one RPC so the plan balance cannot drift when a user edits lines.
begin;

-- A pending request is still a draft from a workflow perspective. Its test
-- item snapshot may therefore be replaced until the stock team confirms it;
-- confirmed/closed snapshots remain immutable.
create or replace function public.service_procurement_allow_pending_snapshot_edit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.service_purchase_requests request_row
    where request_row.id = old.purchase_request_id
      and request_row.status = 'pending'
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception using errcode = '55000', message = 'service PR snapshots are immutable after confirmation';
end
$function$;
revoke execute on function public.service_procurement_allow_pending_snapshot_edit() from public, anon, authenticated;
drop trigger if exists service_purchase_request_test_item_snapshots_append_only on public.service_purchase_request_test_item_snapshots;
create trigger service_purchase_request_test_item_snapshots_append_only
before update or delete on public.service_purchase_request_test_item_snapshots
for each row execute function public.service_procurement_allow_pending_snapshot_edit();

create or replace function public.update_service_purchase_request(
  p_actor_id uuid,
  p_request_id uuid,
  p_payload jsonb
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  balance_row record;
  item_row public.service_plan_test_items%rowtype;
  line_payload jsonb;
  committee_payload jsonb;
  target_plan_id uuid;
  requested_date_value date;
  usage_start_value date;
  usage_end_value date;
  amount_value numeric(17,2);
  calculated_amount numeric(17,2) := 0;
  requested_quantity numeric(15,3);
  existing_reservation numeric(17,2) := 0;
  line_number_value integer := 0;
  payload_item_count integer;
  committee_seats integer;
  specification_count integer;
  inspection_count integer;
  tor_count integer;
  existing_tor_count integer;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'requester');
  select * into request_row
  from public.service_purchase_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'service purchase request not found';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'only pending service requests can be edited';
  end if;
  if not (
    request_row.requester_id = p_actor_id
    or public.service_procurement_actor_has_role(p_actor_id, 'admin')
    or public.service_procurement_actor_has_role(p_actor_id, 'head')
  ) then
    raise exception using errcode = '42501', message = 'actor cannot edit this service purchase request';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'service purchase request payload must be an object';
  end if;

  target_plan_id := nullif(btrim(coalesce(p_payload ->> 'planId', '')), '')::uuid;
  if target_plan_id is null then
    raise exception using errcode = '22023', message = 'service PR requires a plan';
  end if;

  -- Lock both plans in a stable order when the user changes the reference.
  -- This keeps concurrent edits from deadlocking each other.
  if request_row.plan_id = target_plan_id then
    select * into plan_row
    from public.service_procurement_plans
    where id = target_plan_id
    for update;
  elsif request_row.plan_id::text < target_plan_id::text then
    perform 1 from public.service_procurement_plans where id = request_row.plan_id for update;
    select * into plan_row
    from public.service_procurement_plans
    where id = target_plan_id
    for update;
  else
    select * into plan_row
    from public.service_procurement_plans
    where id = target_plan_id
    for update;
    perform 1 from public.service_procurement_plans where id = request_row.plan_id for update;
  end if;
  if plan_row.id is null then
    raise exception using errcode = '23503', message = 'service plan not found';
  end if;
  if plan_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'service plan is not open for PR edits';
  end if;
  if plan_row.fiscal_year <> request_row.fiscal_year then
    raise exception using errcode = '22023', message = 'service PR plan cannot move to another fiscal year';
  end if;

  requested_date_value := (p_payload ->> 'requestedDate')::date;
  usage_start_value := (p_payload ->> 'usageStartDate')::date;
  usage_end_value := (p_payload ->> 'usageEndDate')::date;
  amount_value := (p_payload ->> 'amount')::numeric;
  if requested_date_value is null or usage_start_value is null or usage_end_value is null
    or usage_start_value > usage_end_value then
    raise exception using errcode = '22023', message = 'service PR dates are invalid';
  end if;
  if public.service_procurement_fiscal_year(requested_date_value) <> plan_row.fiscal_year
    or public.service_procurement_fiscal_year(usage_start_value) <> plan_row.fiscal_year
    or public.service_procurement_fiscal_year(usage_end_value) <> plan_row.fiscal_year then
    raise exception using errcode = '22023', message = 'service PR dates must be inside the plan fiscal year';
  end if;
  if amount_value is null or amount_value <= 0 then
    raise exception using errcode = '22023', message = 'service PR amount must be positive';
  end if;

  if plan_row.is_red_cross then
    if exists (
      select 1
      from public.service_plan_test_items plan_item
      where plan_item.plan_id = plan_row.id
        and (plan_item.unit_price is null or plan_item.unit_price <= 0)
    ) then
      raise exception using errcode = '23514', message = 'all test items require a positive unit price before editing a service PR';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
      where not exists (
        select 1
        from public.service_plan_test_items plan_item
        where plan_item.id = (item_payload.value ->> 'planItemId')::uuid
          and plan_item.plan_id = plan_row.id
      )
    ) then
      raise exception using errcode = '23503', message = 'test item does not belong to selected service plan';
    end if;
    for item_row in
      select plan_item.*
      from public.service_plan_test_items plan_item
      where plan_item.plan_id = plan_row.id
      order by plan_item.line_number
    loop
      line_payload := null;
      select item_payload.value into line_payload
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
      where item_payload.value ->> 'planItemId' = item_row.id::text
      limit 1;
      select count(*) into payload_item_count
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
      where item_payload.value ->> 'planItemId' = item_row.id::text;
      if payload_item_count > 1 then
        raise exception using errcode = '23514', message = 'service PR contains duplicate test item';
      end if;
      requested_quantity := greatest(0, coalesce((line_payload ->> 'requestedQuantity')::numeric, 0));
      if requested_quantity < 0 then
        raise exception using errcode = '22023', message = 'test item quantity cannot be negative';
      end if;
      calculated_amount := calculated_amount + round(requested_quantity * item_row.unit_price, 2);
    end loop;
    calculated_amount := round(calculated_amount, 2);
    if amount_value <> calculated_amount then
      raise exception using errcode = '23514', message = 'service PR amount does not match test item totals';
    end if;
  elsif jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) > 0 then
    raise exception using errcode = '22023', message = 'non Red Cross service PR cannot contain test items';
  end if;

  select * into balance_row
  from public.service_procurement_plan_balance(plan_row.id);
  select coalesce(sum(case
    when ledger.entry_kind = 'reservation' then ledger.amount
    when ledger.entry_kind = 'reservation_release' then ledger.amount
    else 0
  end), 0)
  into existing_reservation
  from public.service_plan_ledger ledger
  where ledger.purchase_request_id = p_request_id;
  if request_row.plan_id = plan_row.id then
    if amount_value > balance_row.available + existing_reservation then
      raise exception using errcode = '23514', message = 'service PR exceeds available plan budget';
    end if;
  elsif amount_value > balance_row.available then
    raise exception using errcode = '23514', message = 'service PR exceeds available plan budget';
  end if;

  if jsonb_array_length(coalesce(p_payload -> 'attachments', '[]'::jsonb)) > 0 then
    select count(*) into tor_count
    from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) as attachment_payload(value)
    where attachment_payload.value ->> 'kind' = 'tor';
    if tor_count <> 1 or jsonb_array_length(coalesce(p_payload -> 'attachments', '[]'::jsonb)) <> 1 then
      raise exception using errcode = '23514', message = 'service PR accepts one TOR file';
    end if;
    for line_payload in select value from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) as attachment_payload(value) loop
      if coalesce(line_payload ->> 'kind', '') <> 'tor'
        or coalesce((line_payload ->> 'slot')::integer, 0) <> 1
        or coalesce(line_payload ->> 'storageKey', '') not like 'service-procurement/checklist/%'
        or coalesce(line_payload ->> 'storageKey', '') like '%..%'
        or nullif(btrim(coalesce(line_payload ->> 'fileName', '')), '') is null
        or coalesce(line_payload ->> 'mimeType', '') <> 'application/pdf'
        or not (
          coalesce(line_payload ->> 'sizeBytes', '') ~ '^[0-9]+$'
          and (line_payload ->> 'sizeBytes')::bigint between 1 and 20971520
        ) then
        raise exception using errcode = '22023', message = 'invalid service TOR metadata';
      end if;
    end loop;
    delete from public.service_purchase_request_attachments
    where purchase_request_id = p_request_id and attachment_kind = 'tor' and slot = 1;
    insert into public.service_purchase_request_attachments (
      purchase_request_id, attachment_kind, slot, storage_key, file_name, mime_type, size_bytes, uploaded_by
    )
    select p_request_id, 'tor', 1, line_payload ->> 'storageKey', line_payload ->> 'fileName',
      line_payload ->> 'mimeType', (line_payload ->> 'sizeBytes')::bigint, p_actor_id;
  else
    select count(*) into existing_tor_count
    from public.service_purchase_request_attachments attachment
    where attachment.purchase_request_id = p_request_id
      and attachment.attachment_kind = 'tor'
      and attachment.slot = 1;
    if existing_tor_count <> 1 then
      raise exception using errcode = '23514', message = 'service PR requires one TOR file';
    end if;
  end if;
  if not exists (
    select 1 from public.service_plan_documents document
    where document.plan_id = plan_row.id and document.document_kind = 'quotation'
  ) then
    raise exception using errcode = '23514', message = 'service PR requires a quotation document on the selected plan';
  end if;
  if plan_row.requires_contract and not exists (
    select 1 from public.service_plan_documents document
    where document.plan_id = plan_row.id and document.document_kind = 'contract_page'
  ) then
    raise exception using errcode = '23514', message = 'service PR requires a contract page on the selected plan';
  end if;

  committee_seats := case when amount_value >= 100000 then 3 else 1 end;
  select count(*) into specification_count
  from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  where committee_entry.value ->> 'kind' = 'specification';
  select count(*) into inspection_count
  from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  where committee_entry.value ->> 'kind' = 'inspection';
  if specification_count <> committee_seats or inspection_count <> committee_seats then
    raise exception using errcode = '23514', message = 'service PR committee roster is incomplete';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
    where not coalesce((committee_entry.value ->> 'seat') ~ '^[1-3]$', false)
      or (committee_entry.value ->> 'seat')::integer > committee_seats
  ) then
    raise exception using errcode = '23514', message = 'service PR committee seats are invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
    group by committee_entry.value ->> 'kind', committee_entry.value ->> 'seat'
    having count(*) > 1
  ) then
    raise exception using errcode = '23514', message = 'service PR committee seats cannot repeat';
  end if;
  if exists (
    select 1
    from (values ('specification'), ('inspection')) expected(kind)
    where exists (
      select 1
      from generate_series(1, committee_seats) seat
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
        where committee_entry.value ->> 'kind' = expected.kind
          and (committee_entry.value ->> 'seat')::integer = seat
      )
    )
  ) then
    raise exception using errcode = '23514', message = 'service PR committee seats must be consecutive';
  end if;

  if plan_row.is_red_cross then
    delete from public.service_purchase_request_test_item_snapshots
    where purchase_request_id = p_request_id;
    for item_row in
      select plan_item.*
      from public.service_plan_test_items plan_item
      where plan_item.plan_id = plan_row.id
      order by plan_item.line_number
    loop
      line_number_value := line_number_value + 1;
      line_payload := null;
      select item_payload.value into line_payload
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
      where item_payload.value ->> 'planItemId' = item_row.id::text
      limit 1;
      insert into public.service_purchase_request_test_item_snapshots (
        purchase_request_id, plan_item_id, line_number, name, unit, unit_price, requested_quantity
      ) values (
        p_request_id, item_row.id, line_number_value, item_row.name, item_row.unit, item_row.unit_price,
        greatest(0, coalesce((line_payload ->> 'requestedQuantity')::numeric, 0))
      );
    end loop;
  else
    delete from public.service_purchase_request_test_item_snapshots
    where purchase_request_id = p_request_id;
  end if;

  delete from public.service_purchase_request_committees
  where purchase_request_id = p_request_id;
  for committee_payload in
    select value
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  loop
    insert into public.service_purchase_request_committees (
      purchase_request_id, committee_kind, seat, profile_id, name_snapshot, position_snapshot
    )
    select p_request_id, committee_payload ->> 'kind', (committee_payload ->> 'seat')::smallint,
      profile.id, coalesce(profile.name, profile.id::text), profile.role
    from public.profiles profile
    where profile.id = (committee_payload ->> 'profileId')::uuid
      and profile.status = 'active' and profile.deleted_at is null;
    if not found then
      raise exception using errcode = '23503', message = 'committee profile is inactive or missing';
    end if;
  end loop;

  if existing_reservation > 0 then
    insert into public.service_plan_ledger (
      plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id
    ) values (
      request_row.plan_id, 'reservation_release', -existing_reservation, requested_date_value,
      p_request_id, 'คืนยอดสำรองเมื่อแก้ไขใบ PR งานจ้าง', request_row.document_number, p_actor_id
    );
  end if;
  insert into public.service_plan_ledger (
    plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id
  ) values (
    plan_row.id, 'reservation', amount_value, requested_date_value,
    p_request_id, 'สำรองวงเงินเมื่อแก้ไขใบ PR งานจ้าง', request_row.document_number, p_actor_id
  );

  update public.service_purchase_requests
  set fiscal_year = plan_row.fiscal_year,
      department = btrim(p_payload ->> 'department'),
      requested_date = requested_date_value,
      note = nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
      plan_id = plan_row.id,
      requested_amount = amount_value,
      usage_start_date = usage_start_value,
      usage_end_date = usage_end_value,
      updated_by = p_actor_id
  where id = p_request_id
  returning * into request_row;
  return request_row;
end
$function$;
revoke execute on function public.update_service_purchase_request(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_service_purchase_request(uuid, uuid, jsonb) to service_role;

commit;
