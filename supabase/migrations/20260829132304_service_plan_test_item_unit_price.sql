begin;

-- Prices are required for new plans, while nullable keeps historical plans
-- readable until their test-item rows are edited with a real price.
alter table public.service_plan_test_items
  add column if not exists unit_price numeric(14,2);

do $service_plan_test_item_price$begin
  alter table public.service_plan_test_items
    drop constraint if exists service_plan_test_items_unit_price_check;
  alter table public.service_plan_test_items
    add constraint service_plan_test_items_unit_price_check
    check (unit_price is null or unit_price > 0);
end$service_plan_test_item_price$;

alter table public.service_purchase_request_test_item_snapshots
  add column if not exists unit_price numeric(14,2);

do $service_request_test_item_price$begin
  alter table public.service_purchase_request_test_item_snapshots
    drop constraint if exists service_purchase_request_test_item_snapshots_unit_price_check;
  alter table public.service_purchase_request_test_item_snapshots
    add constraint service_purchase_request_test_item_snapshots_unit_price_check
    check (unit_price is null or unit_price > 0);
end$service_request_test_item_price$;

create or replace function public.create_service_procurement_plan(p_actor_id uuid, p_payload jsonb)
returns public.service_procurement_plans language plpgsql security invoker set search_path = '' as $function$
declare
  plan_row public.service_procurement_plans%rowtype;
  line jsonb; line_no integer := 0; profile_id uuid;
  is_red_cross_value boolean := coalesce((p_payload ->> 'isRedCross')::boolean, false);
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception using errcode = '22023', message = 'service plan payload must be an object'; end if;
  if not is_red_cross_value and jsonb_array_length(coalesce(p_payload -> 'testItems', '[]'::jsonb)) > 0 then
    raise exception using errcode = '22023', message = 'test items require a Red Cross plan';
  end if;
  insert into public.service_procurement_plans (
    fiscal_year, name, department, plan_type, budget, is_red_cross, requires_contract, status, created_by, updated_by
  ) values (
    (p_payload ->> 'fiscalYear')::integer, btrim(p_payload ->> 'name'), btrim(p_payload ->> 'department'),
    p_payload ->> 'type', (p_payload ->> 'budget')::numeric, is_red_cross_value,
    coalesce((p_payload ->> 'requiresContract')::boolean, false), 'active', p_actor_id, p_actor_id
  ) returning * into plan_row;
  for line in select value from jsonb_array_elements(coalesce(p_payload -> 'testItems', '[]'::jsonb)) loop
    line_no := line_no + 1;
    if not coalesce((line ->> 'unitPrice') ~ '^[0-9]+(\.[0-9]{1,2})?$', false)
      or (line ->> 'unitPrice')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'test item unit price must be positive';
    end if;
    insert into public.service_plan_test_items(plan_id, line_number, name, unit, unit_price)
    values (plan_row.id, line_no, btrim(line ->> 'name'), btrim(line ->> 'unit'), (line ->> 'unitPrice')::numeric);
  end loop;
  for profile_id in select value::uuid from jsonb_array_elements_text(coalesce(p_payload -> 'responsibleProfileIds', '[]'::jsonb)) value loop
    if not exists (select 1 from public.profiles profile where profile.id = profile_id and profile.status = 'active' and profile.deleted_at is null) then
      raise exception using errcode = '23503', message = 'responsible profile is not active';
    end if;
    insert into public.service_plan_responsibles(plan_id, profile_id, assigned_by) values (plan_row.id, profile_id, p_actor_id);
    insert into public.service_plan_responsible_audit(plan_id, profile_id, action, actor_id) values (plan_row.id, profile_id, 'added', p_actor_id);
  end loop;
  return plan_row;
end
$function$;
revoke execute on function public.create_service_procurement_plan(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_service_procurement_plan(uuid, jsonb) to service_role;

create or replace function public.update_service_procurement_plan(p_actor_id uuid, p_plan_id uuid, p_payload jsonb)
returns public.service_procurement_plans language plpgsql security invoker set search_path = '' as $function$
declare
  current_plan public.service_procurement_plans%rowtype;
  updated_plan public.service_procurement_plans%rowtype;
  expected_updated_at timestamptz;
  line jsonb; line_no integer := 0;
  desired_ids uuid[] := '{}'::uuid[];
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  select * into current_plan from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  expected_updated_at := nullif(p_payload ->> 'expectedUpdatedAt', '')::timestamptz;
  if expected_updated_at is not null and current_plan.updated_at is distinct from expected_updated_at then raise exception using errcode = '40001', message = 'service plan changed by another user'; end if;
  if current_plan.status <> 'active' then raise exception using errcode = '55000', message = 'only active service plans can be edited'; end if;
  if exists (select 1 from public.service_purchase_requests request where request.plan_id = p_plan_id)
    and coalesce((p_payload ->> 'requiresContract')::boolean, false) is distinct from current_plan.requires_contract then
    raise exception using errcode = '55000', message = 'cannot change contract requirement after a PR references this plan';
  end if;
  if not coalesce((p_payload ->> 'isRedCross')::boolean, false)
    and jsonb_array_length(coalesce(p_payload -> 'testItems', '[]'::jsonb)) > 0 then
    raise exception using errcode = '22023', message = 'test items require a Red Cross plan';
  end if;
  update public.service_procurement_plans set
    fiscal_year = (p_payload ->> 'fiscalYear')::integer,
    name = btrim(p_payload ->> 'name'), department = btrim(p_payload ->> 'department'),
    plan_type = p_payload ->> 'type', budget = (p_payload ->> 'budget')::numeric,
    is_red_cross = coalesce((p_payload ->> 'isRedCross')::boolean, false),
    requires_contract = coalesce((p_payload ->> 'requiresContract')::boolean, false), updated_by = p_actor_id
  where id = p_plan_id returning * into updated_plan;
  delete from public.service_plan_test_items where plan_id = p_plan_id;
  for line in select value from jsonb_array_elements(coalesce(p_payload -> 'testItems', '[]'::jsonb)) loop
    line_no := line_no + 1;
    if not coalesce((line ->> 'unitPrice') ~ '^[0-9]+(\.[0-9]{1,2})?$', false)
      or (line ->> 'unitPrice')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'test item unit price must be positive';
    end if;
    insert into public.service_plan_test_items(plan_id, line_number, name, unit, unit_price)
    values (p_plan_id, line_no, btrim(line ->> 'name'), btrim(line ->> 'unit'), (line ->> 'unitPrice')::numeric);
  end loop;
  select coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload -> 'responsibleProfileIds', '[]'::jsonb)) value), '{}'::uuid[]) into desired_ids;
  perform public.set_service_plan_responsibles(p_actor_id, p_plan_id, desired_ids);
  return updated_plan;
end
$function$;
revoke execute on function public.update_service_procurement_plan(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_service_procurement_plan(uuid, uuid, jsonb) to service_role;

create or replace function public.create_service_purchase_request(p_actor_id uuid, p_payload jsonb)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare
  actor_profile public.profiles%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  request_row public.service_purchase_requests%rowtype;
  balance record;
  line jsonb; committee jsonb; payload_item_count integer;
  item_row public.service_plan_test_items%rowtype;
  line_no integer := 0; next_sequence integer; amount_value numeric(17,2);
  usage_start date; usage_end date; request_date date;
  committee_seats integer; spec_count integer; inspection_count integer; tor_count integer;
  has_prior_request boolean;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'requester');
  select * into actor_profile from public.profiles where id = p_actor_id;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception using errcode = '22023', message = 'service purchase request payload must be an object'; end if;
  if nullif(btrim(coalesce(p_payload ->> 'planId', '')), '') is null then raise exception using errcode = '22023', message = 'service PR requires a plan'; end if;
  request_date := (p_payload ->> 'requestedDate')::date;
  usage_start := (p_payload ->> 'usageStartDate')::date;
  usage_end := (p_payload ->> 'usageEndDate')::date;
  amount_value := (p_payload ->> 'amount')::numeric;
  select * into plan_row from public.service_procurement_plans where id = (p_payload ->> 'planId')::uuid for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  if plan_row.status <> 'active' then raise exception using errcode = '55000', message = 'service plan is not open for new PR'; end if;
  if plan_row.is_red_cross and exists (
    select 1 from public.service_plan_test_items item
    where item.plan_id = plan_row.id and (item.unit_price is null or item.unit_price <= 0)
  ) then
    raise exception using errcode = '23514', message = 'all test items require a positive unit price before creating a service PR';
  end if;
  select exists (select 1 from public.service_purchase_requests request where request.plan_id = plan_row.id) into has_prior_request;
  if public.service_procurement_fiscal_year(request_date) <> plan_row.fiscal_year
    or public.service_procurement_fiscal_year(usage_start) <> plan_row.fiscal_year
    or public.service_procurement_fiscal_year(usage_end) <> plan_row.fiscal_year
    or usage_start > usage_end then raise exception using errcode = '22023', message = 'service PR dates must be inside the plan fiscal year'; end if;
  if public.service_procurement_fiscal_year((timezone('Asia/Bangkok', now()))::date) > plan_row.fiscal_year then raise exception using errcode = '55000', message = 'service plan fiscal year is closed for new PR'; end if;
  if amount_value is null or amount_value <= 0 then raise exception using errcode = '22023', message = 'service PR amount must be positive'; end if;
  select * into balance from public.service_procurement_plan_balance(plan_row.id);
  if amount_value > balance.available then raise exception using errcode = '23514', message = 'service PR exceeds available plan budget'; end if;
  if not plan_row.is_red_cross and jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) > 0 then raise exception using errcode = '22023', message = 'non Red Cross service PR cannot contain test items'; end if;
  if plan_row.is_red_cross and exists (
    select 1 from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) entry
    where not exists (select 1 from public.service_plan_test_items item where item.id = (entry ->> 'planItemId')::uuid and item.plan_id = plan_row.id)
  ) then raise exception using errcode = '23503', message = 'test item does not belong to selected service plan'; end if;
  perform pg_advisory_xact_lock(hashtext('labcbh_service_purchase_request_sequence'), plan_row.fiscal_year);
  select coalesce(max(request.sequence_number), 0) + 1 into next_sequence from public.service_purchase_requests request where request.fiscal_year = plan_row.fiscal_year;
  insert into public.service_purchase_requests (
    fiscal_year, sequence_number, document_number, requester_id, requester_name, department,
    requested_date, note, plan_id, purchase_method, requested_amount, requested_po_month,
    usage_start_date, usage_end_date, created_by, updated_by
  ) values (
    plan_row.fiscal_year, next_sequence, 'SPR-' || plan_row.fiscal_year || '-' || lpad(next_sequence::text, 4, '0'),
    p_actor_id, coalesce(nullif(btrim(actor_profile.name), ''), p_actor_id::text), btrim(p_payload ->> 'department'),
    request_date, nullif(btrim(coalesce(p_payload ->> 'note', '')), ''), plan_row.id, 'laboratory_testing', amount_value,
    null, usage_start, usage_end, p_actor_id, p_actor_id
  ) returning * into request_row;
  for item_row in select item.* from public.service_plan_test_items item where item.plan_id = plan_row.id order by item.line_number loop
    line_no := line_no + 1;
    line := null;
    select entry into line from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) entry where entry ->> 'planItemId' = item_row.id::text limit 1;
    select count(*) into payload_item_count from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) entry where entry ->> 'planItemId' = item_row.id::text;
    if payload_item_count > 1 then raise exception using errcode = '23514', message = 'service PR contains duplicate test item'; end if;
    if coalesce((line ->> 'requestedQuantity')::numeric, 0) < 0 then raise exception using errcode = '22023', message = 'test item quantity cannot be negative'; end if;
    insert into public.service_purchase_request_test_item_snapshots (
      purchase_request_id, plan_item_id, line_number, name, unit, unit_price, requested_quantity
    ) values (
      request_row.id, item_row.id, line_no, item_row.name, item_row.unit, item_row.unit_price,
      greatest(0, coalesce((line ->> 'requestedQuantity')::numeric, 0))
    );
  end loop;
  select count(*) into tor_count from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) entry where entry ->> 'kind' = 'tor';
  if tor_count <> 1 then raise exception using errcode = '23514', message = 'service PR requires one TOR file'; end if;
  for line in select value from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) loop
    if coalesce(line ->> 'kind', '') <> 'tor'
      or coalesce((line ->> 'slot')::integer, 0) <> 1
      or coalesce(line ->> 'storageKey', '') not like 'service-procurement/checklist/%'
      or coalesce(line ->> 'storageKey', '') like '%..%'
      or nullif(btrim(coalesce(line ->> 'fileName', '')), '') is null
      or coalesce(line ->> 'mimeType', '') <> 'application/pdf'
      or not (
        coalesce(line ->> 'sizeBytes', '') ~ '^[0-9]+$'
        and (case when coalesce(line ->> 'sizeBytes', '') ~ '^[0-9]+$' then (line ->> 'sizeBytes')::bigint else 0 end) between 1 and 20971520
      ) then
      raise exception using errcode = '22023', message = 'invalid service TOR metadata';
    end if;
    insert into public.service_purchase_request_attachments (
      purchase_request_id, attachment_kind, slot, storage_key, file_name, mime_type, size_bytes, uploaded_by
    ) values (request_row.id, 'tor', 1, line ->> 'storageKey', line ->> 'fileName', line ->> 'mimeType', (line ->> 'sizeBytes')::bigint, p_actor_id);
  end loop;
  if not exists (select 1 from public.service_plan_documents document where document.plan_id = plan_row.id and document.document_kind = 'quotation')
    or (not has_prior_request and not coalesce((p_payload -> 'documentChoices' ->> 'replaceQuotation')::boolean, false)) then
    raise exception using errcode = '23514', message = 'first service PR requires a newly attached quotation document';
  end if;
  if plan_row.requires_contract
    and (not exists (select 1 from public.service_plan_documents document where document.plan_id = plan_row.id and document.document_kind = 'contract_page')
      or (not has_prior_request and not coalesce((p_payload -> 'documentChoices' ->> 'replaceContractPage')::boolean, false))) then
    raise exception using errcode = '23514', message = 'first service PR requires a newly attached contract page';
  end if;
  committee_seats := case when amount_value >= 100000 then 3 else 1 end;
  select count(*) into spec_count from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) entry where entry ->> 'kind' = 'specification';
  select count(*) into inspection_count from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) entry where entry ->> 'kind' = 'inspection';
  if spec_count <> committee_seats or inspection_count <> committee_seats then raise exception using errcode = '23514', message = 'service PR committee roster is incomplete'; end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) entry
    where not coalesce((entry ->> 'seat') ~ '^[1-3]$', false)
      or (entry ->> 'seat')::integer > committee_seats
  ) then raise exception using errcode = '23514', message = 'service PR committee seats are invalid'; end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) entry
    group by entry ->> 'kind', entry ->> 'seat'
    having count(*) > 1
  ) then raise exception using errcode = '23514', message = 'service PR committee seats cannot repeat'; end if;
  if exists (
    select 1
    from (values ('specification'), ('inspection')) expected(kind)
    where exists (
      select 1
      from generate_series(1, committee_seats) seat
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) entry
        where entry ->> 'kind' = expected.kind
          and (entry ->> 'seat')::integer = seat
      )
    )
  ) then raise exception using errcode = '23514', message = 'service PR committee seats must be consecutive'; end if;
  for committee in select value from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) loop
    insert into public.service_purchase_request_committees(purchase_request_id, committee_kind, seat, profile_id, name_snapshot, position_snapshot)
    select request_row.id, committee ->> 'kind', (committee ->> 'seat')::smallint, profile.id, coalesce(profile.name, profile.id::text), profile.role
    from public.profiles profile where profile.id = (committee ->> 'profileId')::uuid and profile.status = 'active' and profile.deleted_at is null;
    if not found then raise exception using errcode = '23503', message = 'committee profile is inactive or missing'; end if;
  end loop;
  insert into public.service_plan_ledger(plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id)
  values (plan_row.id, 'reservation', amount_value, request_date, request_row.id, 'สำรองวงเงินเมื่อส่งใบ PR', request_row.document_number, p_actor_id);
  return request_row;
end
$function$;
revoke execute on function public.create_service_purchase_request(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_service_purchase_request(uuid, jsonb) to service_role;

commit;
