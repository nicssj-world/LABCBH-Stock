-- Service-only contract-plan document flow.
-- Purchase (inventory) tables and RPCs are intentionally not changed here.
begin;

-- A service PR can be prepared before year-end for work delivered in the
-- following October. The requested date remains inside the plan fiscal year;
-- only the PO usage window receives this service-only carryover period.
create or replace function public.service_procurement_plan_usage_date_allowed(
  p_plan_fiscal_year integer,
  p_usage_date date
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p_plan_fiscal_year is not null
    and p_usage_date is not null
    and p_usage_date >= make_date(p_plan_fiscal_year - 544, 10, 1)
    and p_usage_date <= make_date(p_plan_fiscal_year - 543, 10, 31);
$function$;
revoke execute on function public.service_procurement_plan_usage_date_allowed(integer, date) from public, anon, authenticated;
grant execute on function public.service_procurement_plan_usage_date_allowed(integer, date) to service_role;

-- Contract documents are uploaded from the service plan detail by an admin or
-- stock officer. Keep quotation uploads compatible with the existing service
-- workflow, but require the contract document itself to be a PDF.
create or replace function public.upsert_service_plan_document(
  p_actor_id uuid,
  p_plan_id uuid,
  p_document_kind text,
  p_storage_key text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_checksum text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  row_plan public.service_procurement_plans%rowtype;
  row_old_document public.service_plan_documents%rowtype;
  row_next_document public.service_plan_documents%rowtype;
begin
  if not (
    public.service_procurement_actor_has_role(p_actor_id, 'admin')
    or public.service_procurement_actor_has_role(p_actor_id, 'head')
    or public.service_procurement_actor_has_role(p_actor_id, 'stock_officer')
  ) then
    raise exception using errcode = '42501', message = 'ไม่มีสิทธิ์แนบเอกสารแผนงานจ้าง';
  end if;
  if p_document_kind not in ('quotation', 'contract_page')
    or p_storage_key is null
    or p_storage_key not like ('service-procurement/plan-document/' || p_plan_id::text || '/%')
    or p_storage_key like '%..%'
    or nullif(btrim(coalesce(p_file_name, '')), '') is null then
    raise exception using errcode = '22023', message = 'ข้อมูลเอกสารแผนงานจ้างไม่ถูกต้อง';
  end if;
  if p_document_kind = 'contract_page' and p_mime_type <> 'application/pdf' then
    raise exception using errcode = '22023', message = 'ไฟล์สัญญาต้องเป็น PDF เท่านั้น';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or p_size_bytes < 1
    or p_size_bytes > 20971520 then
    raise exception using errcode = '22023', message = 'ชนิดหรือขนาดเอกสารแผนงานจ้างไม่ถูกต้อง';
  end if;

  select
    plan.id,
    plan.fiscal_year,
    plan.name,
    plan.department,
    plan.plan_type,
    plan.budget,
    plan.created_by,
    plan.updated_by,
    plan.created_at,
    plan.updated_at,
    plan.is_red_cross,
    plan.requires_contract,
    plan.status,
    plan.closed_at,
    plan.rollover_source_plan_id
  into row_plan
  from public.service_procurement_plans plan
  where plan.id = p_plan_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'service plan not found';
  end if;
  if row_plan.status <> 'active' then
    raise exception using errcode = '55000', message = 'only active service plans can change documents';
  end if;
  if p_document_kind = 'contract_page' and not row_plan.requires_contract then
    raise exception using errcode = '22023', message = 'contract page is allowed only for plans that require a contract';
  end if;

  select
    document.id,
    document.plan_id,
    document.document_kind,
    document.storage_key,
    document.file_name,
    document.mime_type,
    document.size_bytes,
    document.checksum,
    document.uploaded_by,
    document.uploaded_at
  into row_old_document
  from public.service_plan_documents document
  where document.plan_id = p_plan_id
    and document.document_kind = p_document_kind
  for update;

  insert into public.service_plan_documents (
    plan_id,
    document_kind,
    storage_key,
    file_name,
    mime_type,
    size_bytes,
    checksum,
    uploaded_by
  )
  values (
    p_plan_id,
    p_document_kind,
    p_storage_key,
    btrim(p_file_name),
    p_mime_type,
    p_size_bytes,
    p_checksum,
    p_actor_id
  )
  on conflict (plan_id, document_kind) do update set
    storage_key = excluded.storage_key,
    file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    checksum = excluded.checksum,
    uploaded_by = excluded.uploaded_by,
    uploaded_at = now()
  returning
    id,
    plan_id,
    document_kind,
    storage_key,
    file_name,
    mime_type,
    size_bytes,
    checksum,
    uploaded_by,
    uploaded_at
  into row_next_document;

  insert into public.service_plan_document_audit (
    plan_id,
    document_kind,
    action,
    previous_storage_key,
    storage_key,
    file_name,
    mime_type,
    size_bytes,
    checksum,
    actor_id
  )
  values (
    p_plan_id,
    p_document_kind,
    case when row_old_document.id is null then 'attached' else 'replaced' end,
    row_old_document.storage_key,
    row_next_document.storage_key,
    row_next_document.file_name,
    row_next_document.mime_type,
    row_next_document.size_bytes,
    row_next_document.checksum,
    p_actor_id
  );
  return jsonb_build_object(
    'document', to_jsonb(row_next_document),
    'oldStorageKey', row_old_document.storage_key
  );
end
$function$;
revoke execute on function public.upsert_service_plan_document(uuid, uuid, text, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.upsert_service_plan_document(uuid, uuid, text, text, text, text, bigint, text) to service_role;

-- A service PR that references a contract-backed plan consumes the contract
-- document already stored on that plan. It never accepts a TOR or quotation
-- upload in the PR payload.
create or replace function public.create_service_purchase_request(
  p_actor_id uuid,
  p_payload jsonb
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  row_plan public.service_procurement_plans%rowtype;
  row_request public.service_purchase_requests%rowtype;
  row_item public.service_plan_test_items%rowtype;
  payload_line jsonb;
  payload_committee jsonb;
  v_actor_name text;
  v_plan_id uuid;
  v_request_id uuid;
  v_document_number text;
  v_request_date date;
  v_usage_start date;
  v_usage_end date;
  v_amount numeric(17,2);
  v_plan_available numeric(17,2);
  v_next_sequence integer;
  v_line_number integer := 0;
  v_payload_item_count integer;
  v_committee_seats integer;
  v_specification_count integer;
  v_inspection_count integer;
  v_tor_count integer;
  v_has_prior_request boolean;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'requester');
  select profile.name
  into v_actor_name
  from public.profiles profile
  where profile.id = p_actor_id;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'service purchase request payload must be an object';
  end if;
  v_plan_id := nullif(btrim(coalesce(p_payload ->> 'planId', '')), '')::uuid;
  if v_plan_id is null then
    raise exception using errcode = '22023', message = 'service PR requires a plan';
  end if;
  v_request_date := (p_payload ->> 'requestedDate')::date;
  v_usage_start := (p_payload ->> 'usageStartDate')::date;
  v_usage_end := (p_payload ->> 'usageEndDate')::date;
  v_amount := (p_payload ->> 'amount')::numeric;

  select
    plan.id,
    plan.fiscal_year,
    plan.name,
    plan.department,
    plan.plan_type,
    plan.budget,
    plan.created_by,
    plan.updated_by,
    plan.created_at,
    plan.updated_at,
    plan.is_red_cross,
    plan.requires_contract,
    plan.status,
    plan.closed_at,
    plan.rollover_source_plan_id
  into row_plan
  from public.service_procurement_plans plan
  where plan.id = v_plan_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'service plan not found';
  end if;
  if row_plan.status <> 'active' then
    raise exception using errcode = '55000', message = 'service plan is not open for new PR';
  end if;
  if row_plan.is_red_cross and exists (
    select 1
    from public.service_plan_test_items item
    where item.plan_id = row_plan.id
      and (item.unit_price is null or item.unit_price <= 0)
  ) then
    raise exception using errcode = '23514', message = 'all test items require a positive unit price before creating a service PR';
  end if;
  select exists (
    select 1
    from public.service_purchase_requests request_row
    where request_row.plan_id = row_plan.id
  )
  into v_has_prior_request;
  if v_request_date is null
    or v_usage_start is null
    or v_usage_end is null
    or v_usage_start > v_usage_end
    or public.service_procurement_fiscal_year(v_request_date) <> row_plan.fiscal_year
    or not public.service_procurement_plan_usage_date_allowed(row_plan.fiscal_year, v_usage_start)
    or not public.service_procurement_plan_usage_date_allowed(row_plan.fiscal_year, v_usage_end) then
    raise exception using errcode = '22023', message = 'service PR dates must be inside the plan fiscal year or its October carryover period';
  end if;
  if public.service_procurement_fiscal_year((timezone('Asia/Bangkok', now()))::date) > row_plan.fiscal_year then
    raise exception using errcode = '55000', message = 'service plan fiscal year is closed for new PR';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception using errcode = '22023', message = 'service PR amount must be positive';
  end if;
  select balance_row.available
  into v_plan_available
  from public.service_procurement_plan_balance(row_plan.id) balance_row;
  if v_amount > v_plan_available then
    raise exception using errcode = '23514', message = 'service PR exceeds available plan budget';
  end if;
  if not row_plan.is_red_cross
    and jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) > 0 then
    raise exception using errcode = '22023', message = 'non Red Cross service PR cannot contain test items';
  end if;
  if row_plan.is_red_cross and exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
    where not exists (
      select 1
      from public.service_plan_test_items item
      where item.id = (item_payload.value ->> 'planItemId')::uuid
        and item.plan_id = row_plan.id
    )
  ) then
    raise exception using errcode = '23503', message = 'test item does not belong to selected service plan';
  end if;

  perform pg_advisory_xact_lock(hashtext('labcbh_service_purchase_request_sequence'), row_plan.fiscal_year);
  select coalesce(max(request_row.sequence_number), 0) + 1
  into v_next_sequence
  from public.service_purchase_requests request_row
  where request_row.fiscal_year = row_plan.fiscal_year;
  v_document_number := 'SPR-' || row_plan.fiscal_year || '-' || lpad(v_next_sequence::text, 4, '0');
  insert into public.service_purchase_requests (
    fiscal_year,
    sequence_number,
    document_number,
    requester_id,
    requester_name,
    department,
    requested_date,
    note,
    plan_id,
    purchase_method,
    requested_amount,
    requested_po_month,
    usage_start_date,
    usage_end_date,
    created_by,
    updated_by
  )
  values (
    row_plan.fiscal_year,
    v_next_sequence,
    v_document_number,
    p_actor_id,
    coalesce(nullif(btrim(v_actor_name), ''), p_actor_id::text),
    btrim(p_payload ->> 'department'),
    v_request_date,
    nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
    row_plan.id,
    'laboratory_testing',
    v_amount,
    null,
    v_usage_start,
    v_usage_end,
    p_actor_id,
    p_actor_id
  )
  returning id into v_request_id;

  for row_item in
    select
      item.id,
      item.plan_id,
      item.line_number,
      item.name,
      item.unit,
      item.created_at,
      item.updated_at,
      item.unit_price
    from public.service_plan_test_items item
    where item.plan_id = row_plan.id
    order by item.line_number
  loop
    v_line_number := v_line_number + 1;
    payload_line := null;
    select item_payload.value
    into payload_line
    from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
    where item_payload.value ->> 'planItemId' = row_item.id::text
    limit 1;
    select count(*)
    into v_payload_item_count
    from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
    where item_payload.value ->> 'planItemId' = row_item.id::text;
    if v_payload_item_count > 1 then
      raise exception using errcode = '23514', message = 'service PR contains duplicate test item';
    end if;
    if coalesce((payload_line ->> 'requestedQuantity')::numeric, 0) < 0 then
      raise exception using errcode = '22023', message = 'test item quantity cannot be negative';
    end if;
    insert into public.service_purchase_request_test_item_snapshots (
      purchase_request_id,
      plan_item_id,
      line_number,
      name,
      unit,
      unit_price,
      requested_quantity
    )
    values (
      v_request_id,
      row_item.id,
      v_line_number,
      row_item.name,
      row_item.unit,
      row_item.unit_price,
      greatest(0, coalesce((payload_line ->> 'requestedQuantity')::numeric, 0))
    );
  end loop;

  if row_plan.requires_contract then
    if jsonb_array_length(coalesce(p_payload -> 'attachments', '[]'::jsonb)) <> 0 then
      raise exception using errcode = '23514', message = 'contract-backed service PR must not include TOR or quotation files';
    end if;
    if not exists (
      select 1
      from public.service_plan_documents document
      where document.plan_id = row_plan.id
        and document.document_kind = 'contract_page'
        and document.mime_type = 'application/pdf'
    ) then
      raise exception using errcode = '23514', message = 'contract-backed service PR requires a PDF contract on the selected plan';
    end if;
  else
    select count(*)
    into v_tor_count
    from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) as attachment_payload(value)
    where attachment_payload.value ->> 'kind' = 'tor';
    if v_tor_count <> 1 then
      raise exception using errcode = '23514', message = 'service PR requires one TOR file';
    end if;
    for payload_line in
      select attachment_payload.value
      from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) as attachment_payload(value)
    loop
      if coalesce(payload_line ->> 'kind', '') <> 'tor'
        or coalesce((payload_line ->> 'slot')::integer, 0) <> 1
        or coalesce(payload_line ->> 'storageKey', '') not like 'service-procurement/checklist/%'
        or coalesce(payload_line ->> 'storageKey', '') like '%..%'
        or nullif(btrim(coalesce(payload_line ->> 'fileName', '')), '') is null
        or coalesce(payload_line ->> 'mimeType', '') <> 'application/pdf'
        or not (
          coalesce(payload_line ->> 'sizeBytes', '') ~ '^[0-9]+$'
          and (case
            when coalesce(payload_line ->> 'sizeBytes', '') ~ '^[0-9]+$'
              then (payload_line ->> 'sizeBytes')::bigint
            else 0
          end) between 1 and 20971520
        ) then
        raise exception using errcode = '22023', message = 'invalid service TOR metadata';
      end if;
      insert into public.service_purchase_request_attachments (
        purchase_request_id,
        attachment_kind,
        slot,
        storage_key,
        file_name,
        mime_type,
        size_bytes,
        uploaded_by
      )
      values (
        v_request_id,
        'tor',
        1,
        payload_line ->> 'storageKey',
        payload_line ->> 'fileName',
        payload_line ->> 'mimeType',
        (payload_line ->> 'sizeBytes')::bigint,
        p_actor_id
      );
    end loop;
    if not exists (
      select 1
      from public.service_plan_documents document
      where document.plan_id = row_plan.id
        and document.document_kind = 'quotation'
    )
      or (
        not v_has_prior_request
        and not coalesce((p_payload -> 'documentChoices' ->> 'replaceQuotation')::boolean, false)
      ) then
      raise exception using errcode = '23514', message = 'first service PR requires a newly attached quotation document';
    end if;
  end if;

  v_committee_seats := case when v_amount >= 100000 then 3 else 1 end;
  select count(*)
  into v_specification_count
  from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  where committee_entry.value ->> 'kind' = 'specification';
  select count(*)
  into v_inspection_count
  from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  where committee_entry.value ->> 'kind' = 'inspection';
  if v_specification_count <> v_committee_seats
    or v_inspection_count <> v_committee_seats then
    raise exception using errcode = '23514', message = 'service PR committee roster is incomplete';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
    where not coalesce((committee_entry.value ->> 'seat') ~ '^[1-3]$', false)
      or (
        case
          when coalesce((committee_entry.value ->> 'seat') ~ '^[1-3]$', false)
            then (committee_entry.value ->> 'seat')::integer
          else 0
        end
      ) > v_committee_seats
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
    from (values ('specification'), ('inspection')) as expected_kind(kind)
    where exists (
      select 1
      from generate_series(1, v_committee_seats) as seat_number(seat)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
        where committee_entry.value ->> 'kind' = expected_kind.kind
          and (
            case
              when coalesce((committee_entry.value ->> 'seat') ~ '^[1-3]$', false)
                then (committee_entry.value ->> 'seat')::integer
              else 0
            end
          ) = seat_number.seat
      )
    )
  ) then
    raise exception using errcode = '23514', message = 'service PR committee seats must be consecutive';
  end if;
  for payload_committee in
    select committee_entry.value
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  loop
    insert into public.service_purchase_request_committees (
      purchase_request_id,
      committee_kind,
      seat,
      profile_id,
      name_snapshot,
      position_snapshot
    )
    select
      v_request_id,
      payload_committee ->> 'kind',
      (payload_committee ->> 'seat')::smallint,
      profile.id,
      coalesce(profile.name, profile.id::text),
      profile.role
    from public.profiles profile
    where profile.id = (payload_committee ->> 'profileId')::uuid
      and profile.status = 'active'
      and profile.deleted_at is null;
    if not found then
      raise exception using errcode = '23503', message = 'committee profile is inactive or missing';
    end if;
  end loop;

  insert into public.service_plan_ledger (
    plan_id,
    entry_kind,
    amount,
    event_date,
    purchase_request_id,
    reason,
    source_reference,
    actor_id
  )
  values (
    row_plan.id,
    'reservation',
    v_amount,
    v_request_date,
    v_request_id,
    'สำรองวงเงินเมื่อส่งใบ PR',
    v_document_number,
    p_actor_id
  );

  select
    request_row.id,
    request_row.fiscal_year,
    request_row.sequence_number,
    request_row.document_number,
    request_row.requester_id,
    request_row.requester_name,
    request_row.department,
    request_row.requested_date,
    request_row.note,
    request_row.plan_id,
    request_row.purchase_method,
    request_row.requested_amount,
    request_row.requested_po_month,
    request_row.status,
    request_row.po_status,
    request_row.ephis_pr_number,
    request_row.po_number,
    request_row.po_file_path,
    request_row.po_file_name,
    request_row.po_file_mime_type,
    request_row.po_file_size_bytes,
    request_row.po_file_checksum,
    request_row.confirmed_by,
    request_row.confirmed_at,
    request_row.closed_by,
    request_row.closed_at,
    request_row.cancelled_by,
    request_row.cancelled_at,
    request_row.cancellation_reason,
    request_row.created_by,
    request_row.updated_by,
    request_row.created_at,
    request_row.updated_at,
    request_row.usage_start_date,
    request_row.usage_end_date
  into row_request
  from public.service_purchase_requests request_row
  where request_row.id = v_request_id;
  return row_request;
end
$function$;
revoke execute on function public.create_service_purchase_request(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_service_purchase_request(uuid, jsonb) to service_role;

-- Keep edits consistent with creation: a contract-backed PR retains the
-- plan-level contract reference and accepts no TOR/quotation replacement.
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
  row_request public.service_purchase_requests%rowtype;
  row_plan public.service_procurement_plans%rowtype;
  row_item public.service_plan_test_items%rowtype;
  payload_line jsonb;
  payload_committee jsonb;
  v_target_plan_id uuid;
  v_requested_date date;
  v_usage_start date;
  v_usage_end date;
  v_amount numeric(17,2);
  v_calculated_amount numeric(17,2) := 0;
  v_requested_quantity numeric(15,3);
  v_existing_reservation numeric(17,2) := 0;
  v_plan_available numeric(17,2);
  v_line_number integer := 0;
  v_payload_item_count integer;
  v_committee_seats integer;
  v_specification_count integer;
  v_inspection_count integer;
  v_tor_count integer;
  v_existing_tor_count integer;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'requester');
  select
    request_row.id,
    request_row.fiscal_year,
    request_row.sequence_number,
    request_row.document_number,
    request_row.requester_id,
    request_row.requester_name,
    request_row.department,
    request_row.requested_date,
    request_row.note,
    request_row.plan_id,
    request_row.purchase_method,
    request_row.requested_amount,
    request_row.requested_po_month,
    request_row.status,
    request_row.po_status,
    request_row.ephis_pr_number,
    request_row.po_number,
    request_row.po_file_path,
    request_row.po_file_name,
    request_row.po_file_mime_type,
    request_row.po_file_size_bytes,
    request_row.po_file_checksum,
    request_row.confirmed_by,
    request_row.confirmed_at,
    request_row.closed_by,
    request_row.closed_at,
    request_row.cancelled_by,
    request_row.cancelled_at,
    request_row.cancellation_reason,
    request_row.created_by,
    request_row.updated_by,
    request_row.created_at,
    request_row.updated_at,
    request_row.usage_start_date,
    request_row.usage_end_date
  into row_request
  from public.service_purchase_requests request_row
  where request_row.id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'service purchase request not found';
  end if;
  if row_request.status <> 'pending' then
    raise exception using errcode = '55000', message = 'only pending service requests can be edited';
  end if;
  if not (
    row_request.requester_id = p_actor_id
    or public.service_procurement_actor_has_role(p_actor_id, 'admin')
    or public.service_procurement_actor_has_role(p_actor_id, 'head')
  ) then
    raise exception using errcode = '42501', message = 'actor cannot edit this service purchase request';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'service purchase request payload must be an object';
  end if;

  v_target_plan_id := nullif(btrim(coalesce(p_payload ->> 'planId', '')), '')::uuid;
  if v_target_plan_id is null then
    raise exception using errcode = '22023', message = 'service PR requires a plan';
  end if;

  -- Lock both plans in a stable order when the user changes the reference.
  -- This keeps concurrent edits from deadlocking each other.
  if row_request.plan_id = v_target_plan_id then
    select
      plan.id,
      plan.fiscal_year,
      plan.name,
      plan.department,
      plan.plan_type,
      plan.budget,
      plan.created_by,
      plan.updated_by,
      plan.created_at,
      plan.updated_at,
      plan.is_red_cross,
      plan.requires_contract,
      plan.status,
      plan.closed_at,
      plan.rollover_source_plan_id
    into row_plan
    from public.service_procurement_plans plan
    where plan.id = v_target_plan_id
    for update;
  elsif row_request.plan_id::text < v_target_plan_id::text then
    perform 1
    from public.service_procurement_plans plan
    where plan.id = row_request.plan_id
    for update;
    select
      plan.id,
      plan.fiscal_year,
      plan.name,
      plan.department,
      plan.plan_type,
      plan.budget,
      plan.created_by,
      plan.updated_by,
      plan.created_at,
      plan.updated_at,
      plan.is_red_cross,
      plan.requires_contract,
      plan.status,
      plan.closed_at,
      plan.rollover_source_plan_id
    into row_plan
    from public.service_procurement_plans plan
    where plan.id = v_target_plan_id
    for update;
  else
    select
      plan.id,
      plan.fiscal_year,
      plan.name,
      plan.department,
      plan.plan_type,
      plan.budget,
      plan.created_by,
      plan.updated_by,
      plan.created_at,
      plan.updated_at,
      plan.is_red_cross,
      plan.requires_contract,
      plan.status,
      plan.closed_at,
      plan.rollover_source_plan_id
    into row_plan
    from public.service_procurement_plans plan
    where plan.id = v_target_plan_id
    for update;
    perform 1
    from public.service_procurement_plans plan
    where plan.id = row_request.plan_id
    for update;
  end if;
  if row_plan.id is null then
    raise exception using errcode = '23503', message = 'service plan not found';
  end if;
  if row_plan.status <> 'active' then
    raise exception using errcode = '55000', message = 'service plan is not open for PR edits';
  end if;
  if row_plan.fiscal_year <> row_request.fiscal_year then
    raise exception using errcode = '22023', message = 'service PR plan cannot move to another fiscal year';
  end if;

  v_requested_date := (p_payload ->> 'requestedDate')::date;
  v_usage_start := (p_payload ->> 'usageStartDate')::date;
  v_usage_end := (p_payload ->> 'usageEndDate')::date;
  v_amount := (p_payload ->> 'amount')::numeric;
  if v_requested_date is null
    or v_usage_start is null
    or v_usage_end is null
    or v_usage_start > v_usage_end then
    raise exception using errcode = '22023', message = 'service PR dates are invalid';
  end if;
  if public.service_procurement_fiscal_year(v_requested_date) <> row_plan.fiscal_year
    or not public.service_procurement_plan_usage_date_allowed(row_plan.fiscal_year, v_usage_start)
    or not public.service_procurement_plan_usage_date_allowed(row_plan.fiscal_year, v_usage_end) then
    raise exception using errcode = '22023', message = 'service PR dates must be inside the plan fiscal year or its October carryover period';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception using errcode = '22023', message = 'service PR amount must be positive';
  end if;

  if row_plan.is_red_cross then
    if exists (
      select 1
      from public.service_plan_test_items item
      where item.plan_id = row_plan.id
        and (item.unit_price is null or item.unit_price <= 0)
    ) then
      raise exception using errcode = '23514', message = 'all test items require a positive unit price before editing a service PR';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
      where not exists (
        select 1
        from public.service_plan_test_items item
        where item.id = (item_payload.value ->> 'planItemId')::uuid
          and item.plan_id = row_plan.id
      )
    ) then
      raise exception using errcode = '23503', message = 'test item does not belong to selected service plan';
    end if;
    for row_item in
      select
        item.id,
        item.plan_id,
        item.line_number,
        item.name,
        item.unit,
        item.created_at,
        item.updated_at,
        item.unit_price
      from public.service_plan_test_items item
      where item.plan_id = row_plan.id
      order by item.line_number
    loop
      payload_line := null;
      select item_payload.value
      into payload_line
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
      where item_payload.value ->> 'planItemId' = row_item.id::text
      limit 1;
      select count(*)
      into v_payload_item_count
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
      where item_payload.value ->> 'planItemId' = row_item.id::text;
      if v_payload_item_count > 1 then
        raise exception using errcode = '23514', message = 'service PR contains duplicate test item';
      end if;
      if coalesce((payload_line ->> 'requestedQuantity')::numeric, 0) < 0 then
        raise exception using errcode = '22023', message = 'test item quantity cannot be negative';
      end if;
      v_requested_quantity := greatest(0, coalesce((payload_line ->> 'requestedQuantity')::numeric, 0));
      v_calculated_amount := v_calculated_amount + round(v_requested_quantity * row_item.unit_price, 2);
    end loop;
    v_calculated_amount := round(v_calculated_amount, 2);
    if v_amount <> v_calculated_amount then
      raise exception using errcode = '23514', message = 'service PR amount does not match test item totals';
    end if;
  elsif jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) > 0 then
    raise exception using errcode = '22023', message = 'non Red Cross service PR cannot contain test items';
  end if;

  select balance_row.available
  into v_plan_available
  from public.service_procurement_plan_balance(row_plan.id) balance_row;
  select coalesce(sum(
    case
      when ledger.entry_kind = 'reservation' then ledger.amount
      when ledger.entry_kind = 'reservation_release' then ledger.amount
      else 0
    end
  ), 0)
  into v_existing_reservation
  from public.service_plan_ledger ledger
  where ledger.purchase_request_id = p_request_id;
  if row_request.plan_id = row_plan.id then
    if v_amount > v_plan_available + v_existing_reservation then
      raise exception using errcode = '23514', message = 'service PR exceeds available service plan budget';
    end if;
  elsif v_amount > v_plan_available then
    raise exception using errcode = '23514', message = 'service PR exceeds available service plan budget';
  end if;

  if row_plan.requires_contract then
    if jsonb_array_length(coalesce(p_payload -> 'attachments', '[]'::jsonb)) <> 0 then
      raise exception using errcode = '23514', message = 'contract-backed service PR must not include TOR or quotation files';
    end if;
    if not exists (
      select 1
      from public.service_plan_documents document
      where document.plan_id = row_plan.id
        and document.document_kind = 'contract_page'
        and document.mime_type = 'application/pdf'
    ) then
      raise exception using errcode = '23514', message = 'contract-backed service PR requires a PDF contract on the selected plan';
    end if;
  elsif jsonb_array_length(coalesce(p_payload -> 'attachments', '[]'::jsonb)) > 0 then
    select count(*)
    into v_tor_count
    from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) as attachment_payload(value)
    where attachment_payload.value ->> 'kind' = 'tor';
    if v_tor_count <> 1
      or jsonb_array_length(coalesce(p_payload -> 'attachments', '[]'::jsonb)) <> 1 then
      raise exception using errcode = '23514', message = 'service PR accepts one TOR file';
    end if;
    for payload_line in
      select attachment_payload.value
      from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) as attachment_payload(value)
    loop
      if coalesce(payload_line ->> 'kind', '') <> 'tor'
        or coalesce((payload_line ->> 'slot')::integer, 0) <> 1
        or coalesce(payload_line ->> 'storageKey', '') not like 'service-procurement/checklist/%'
        or coalesce(payload_line ->> 'storageKey', '') like '%..%'
        or nullif(btrim(coalesce(payload_line ->> 'fileName', '')), '') is null
        or coalesce(payload_line ->> 'mimeType', '') <> 'application/pdf'
        or not (
          coalesce(payload_line ->> 'sizeBytes', '') ~ '^[0-9]+$'
          and (payload_line ->> 'sizeBytes')::bigint between 1 and 20971520
        ) then
        raise exception using errcode = '22023', message = 'invalid service TOR metadata';
      end if;
    end loop;
    delete from public.service_purchase_request_attachments attachment
    where attachment.purchase_request_id = p_request_id
      and attachment.attachment_kind = 'tor'
      and attachment.slot = 1;
    insert into public.service_purchase_request_attachments (
      purchase_request_id,
      attachment_kind,
      slot,
      storage_key,
      file_name,
      mime_type,
      size_bytes,
      uploaded_by
    )
    values (
      p_request_id,
      'tor',
      1,
      payload_line ->> 'storageKey',
      payload_line ->> 'fileName',
      payload_line ->> 'mimeType',
      (payload_line ->> 'sizeBytes')::bigint,
      p_actor_id
    );
  else
    select count(*)
    into v_existing_tor_count
    from public.service_purchase_request_attachments attachment
    where attachment.purchase_request_id = p_request_id
      and attachment.attachment_kind = 'tor'
      and attachment.slot = 1;
    if v_existing_tor_count <> 1 then
      raise exception using errcode = '23514', message = 'service PR requires one TOR file';
    end if;
  end if;
  if not row_plan.requires_contract and not exists (
    select 1
    from public.service_plan_documents document
    where document.plan_id = row_plan.id
      and document.document_kind = 'quotation'
  ) then
    raise exception using errcode = '23514', message = 'service PR requires a quotation document on the selected plan';
  end if;

  v_committee_seats := case when v_amount >= 100000 then 3 else 1 end;
  select count(*)
  into v_specification_count
  from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  where committee_entry.value ->> 'kind' = 'specification';
  select count(*)
  into v_inspection_count
  from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  where committee_entry.value ->> 'kind' = 'inspection';
  if v_specification_count <> v_committee_seats
    or v_inspection_count <> v_committee_seats then
    raise exception using errcode = '23514', message = 'service PR committee roster is incomplete';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
    where not coalesce((committee_entry.value ->> 'seat') ~ '^[1-3]$', false)
      or (
        case
          when coalesce((committee_entry.value ->> 'seat') ~ '^[1-3]$', false)
            then (committee_entry.value ->> 'seat')::integer
          else 0
        end
      ) > v_committee_seats
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
    from (values ('specification'), ('inspection')) as expected_kind(kind)
    where exists (
      select 1
      from generate_series(1, v_committee_seats) as seat_number(seat)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
        where committee_entry.value ->> 'kind' = expected_kind.kind
          and (
            case
              when coalesce((committee_entry.value ->> 'seat') ~ '^[1-3]$', false)
                then (committee_entry.value ->> 'seat')::integer
              else 0
            end
          ) = seat_number.seat
      )
    )
  ) then
    raise exception using errcode = '23514', message = 'service PR committee seats must be consecutive';
  end if;

  if row_plan.is_red_cross then
    delete from public.service_purchase_request_test_item_snapshots snapshot_row
    where snapshot_row.purchase_request_id = p_request_id;
    for row_item in
      select
        item.id,
        item.plan_id,
        item.line_number,
        item.name,
        item.unit,
        item.created_at,
        item.updated_at,
        item.unit_price
      from public.service_plan_test_items item
      where item.plan_id = row_plan.id
      order by item.line_number
    loop
      v_line_number := v_line_number + 1;
      payload_line := null;
      select item_payload.value
      into payload_line
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) as item_payload(value)
      where item_payload.value ->> 'planItemId' = row_item.id::text
      limit 1;
      insert into public.service_purchase_request_test_item_snapshots (
        purchase_request_id,
        plan_item_id,
        line_number,
        name,
        unit,
        unit_price,
        requested_quantity
      )
      values (
        p_request_id,
        row_item.id,
        v_line_number,
        row_item.name,
        row_item.unit,
        row_item.unit_price,
        greatest(0, coalesce((payload_line ->> 'requestedQuantity')::numeric, 0))
      );
    end loop;
  else
    delete from public.service_purchase_request_test_item_snapshots snapshot_row
    where snapshot_row.purchase_request_id = p_request_id;
  end if;

  delete from public.service_purchase_request_committees committee_row
  where committee_row.purchase_request_id = p_request_id;
  for payload_committee in
    select committee_entry.value
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) as committee_entry(value)
  loop
    insert into public.service_purchase_request_committees (
      purchase_request_id,
      committee_kind,
      seat,
      profile_id,
      name_snapshot,
      position_snapshot
    )
    select
      p_request_id,
      payload_committee ->> 'kind',
      (payload_committee ->> 'seat')::smallint,
      profile.id,
      coalesce(profile.name, profile.id::text),
      profile.role
    from public.profiles profile
    where profile.id = (payload_committee ->> 'profileId')::uuid
      and profile.status = 'active'
      and profile.deleted_at is null;
    if not found then
      raise exception using errcode = '23503', message = 'committee profile is inactive or missing';
    end if;
  end loop;

  if v_existing_reservation > 0 then
    insert into public.service_plan_ledger (
      plan_id,
      entry_kind,
      amount,
      event_date,
      purchase_request_id,
      reason,
      source_reference,
      actor_id
    )
    values (
      row_request.plan_id,
      'reservation_release',
      -v_existing_reservation,
      v_requested_date,
      p_request_id,
      'คืนยอดสำรองเมื่อแก้ไขใบ PR งานจ้าง',
      row_request.document_number,
      p_actor_id
    );
  end if;
  insert into public.service_plan_ledger (
    plan_id,
    entry_kind,
    amount,
    event_date,
    purchase_request_id,
    reason,
    source_reference,
    actor_id
  )
  values (
    row_plan.id,
    'reservation',
    v_amount,
    v_requested_date,
    p_request_id,
    'สำรองวงเงินเมื่อแก้ไขใบ PR งานจ้าง',
    row_request.document_number,
    p_actor_id
  );

  update public.service_purchase_requests request_row
  set fiscal_year = row_plan.fiscal_year,
      department = btrim(p_payload ->> 'department'),
      requested_date = v_requested_date,
      note = nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
      plan_id = row_plan.id,
      requested_amount = v_amount,
      usage_start_date = v_usage_start,
      usage_end_date = v_usage_end,
      updated_by = p_actor_id
  where request_row.id = p_request_id;

  select
    request_row.id,
    request_row.fiscal_year,
    request_row.sequence_number,
    request_row.document_number,
    request_row.requester_id,
    request_row.requester_name,
    request_row.department,
    request_row.requested_date,
    request_row.note,
    request_row.plan_id,
    request_row.purchase_method,
    request_row.requested_amount,
    request_row.requested_po_month,
    request_row.status,
    request_row.po_status,
    request_row.ephis_pr_number,
    request_row.po_number,
    request_row.po_file_path,
    request_row.po_file_name,
    request_row.po_file_mime_type,
    request_row.po_file_size_bytes,
    request_row.po_file_checksum,
    request_row.confirmed_by,
    request_row.confirmed_at,
    request_row.closed_by,
    request_row.closed_at,
    request_row.cancelled_by,
    request_row.cancelled_at,
    request_row.cancellation_reason,
    request_row.created_by,
    request_row.updated_by,
    request_row.created_at,
    request_row.updated_at,
    request_row.usage_start_date,
    request_row.usage_end_date
  into row_request
  from public.service_purchase_requests request_row
  where request_row.id = p_request_id;
  return row_request;
end
$function$;
revoke execute on function public.update_service_purchase_request(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_service_purchase_request(uuid, uuid, jsonb) to service_role;

commit;
