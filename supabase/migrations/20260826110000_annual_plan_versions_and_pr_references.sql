-- Immutable annual-plan versions, searchable row coordinates, and per-line PR
-- references. The original annual-plan table remains the current-slot pointer
-- so existing screens and old PRs keep their lifecycle unchanged.
begin;

create table public.lab_stock_annual_plan_versions (
  id uuid primary key default gen_random_uuid(),
  annual_plan_id uuid not null,
  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  plan_type text not null check (plan_type in ('procurement', 'hiring')),
  file_path text not null check (
    file_path like 'annual-plans/%'
    and file_path not like '%..%'
  ),
  file_name text not null check (nullif(btrim(file_name), '') is not null),
  file_mime_type text not null check (lower(file_mime_type) = 'application/pdf'),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 26214400),
  source_checksum text check (source_checksum is null or source_checksum ~ '^[0-9a-f]{64}$'),
  index_status text not null default 'pending' check (index_status in ('pending', 'ready', 'failed')),
  index_error text,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (annual_plan_id, file_path)
);

create index lab_stock_annual_plan_versions_slot_idx
  on public.lab_stock_annual_plan_versions (fiscal_year desc, plan_type, uploaded_at desc);

create table public.lab_stock_annual_plan_rows (
  id uuid primary key default gen_random_uuid(),
  annual_plan_version_id uuid not null references public.lab_stock_annual_plan_versions(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  plan_sequence text not null check (nullif(btrim(plan_sequence), '') is not null),
  item_name text not null check (nullif(btrim(item_name), '') is not null),
  ls_code text,
  raw_text text not null check (nullif(btrim(raw_text), '') is not null),
  page_number integer not null check (page_number > 0),
  page_width numeric(12,3) not null check (page_width > 0),
  page_height numeric(12,3) not null check (page_height > 0),
  x numeric(12,3) not null check (x >= 0),
  y numeric(12,3) not null check (y >= 0),
  width numeric(12,3) not null check (width > 0),
  height numeric(12,3) not null check (height > 0),
  created_at timestamptz not null default now(),
  unique (annual_plan_version_id, line_number)
);

create index lab_stock_annual_plan_rows_search_idx
  on public.lab_stock_annual_plan_rows (annual_plan_version_id, line_number);
create index lab_stock_annual_plan_rows_code_idx
  on public.lab_stock_annual_plan_rows (annual_plan_version_id, ls_code)
  where ls_code is not null;

alter table public.lab_stock_annual_plans
  add column if not exists current_version_id uuid;

alter table public.lab_stock_annual_plans
  add constraint lab_stock_annual_plans_current_version_fk
  foreign key (current_version_id)
  references public.lab_stock_annual_plan_versions(id)
  on delete set null;

-- Backfill a version pointer for files uploaded before row indexing existed.
-- The application lazily indexes these files the first time a PR form needs
-- them, so no user has to upload the same PDF again.
insert into public.lab_stock_annual_plan_versions (
  annual_plan_id, fiscal_year, plan_type, file_path, file_name,
  file_mime_type, file_size_bytes, uploaded_by, uploaded_at, index_status
)
select plan.id, plan.fiscal_year, plan.plan_type, plan.file_path, plan.file_name,
       plan.file_mime_type, plan.file_size_bytes, plan.uploaded_by, plan.uploaded_at,
       'pending'
from public.lab_stock_annual_plans plan
where not exists (
  select 1
  from public.lab_stock_annual_plan_versions version
  where version.annual_plan_id = plan.id
    and version.file_path = plan.file_path
);

update public.lab_stock_annual_plans plan
set current_version_id = version.id
from public.lab_stock_annual_plan_versions version
where version.annual_plan_id = plan.id
  and version.file_path = plan.file_path
  and plan.current_version_id is null;

alter table public.purchase_requests
  add column if not exists annual_plan_reference_required boolean not null default false;

alter table public.purchase_request_upload_tickets
  add column if not exists generated_by_system boolean not null default false,
  add column if not exists annual_plan_version_id uuid references public.lab_stock_annual_plan_versions(id) on delete restrict;

alter table public.purchase_request_attachments
  add column if not exists generated_by_system boolean not null default false,
  add column if not exists annual_plan_version_id uuid references public.lab_stock_annual_plan_versions(id) on delete restrict;

-- Existing checklist SQL inserts attachment metadata from the upload ticket but
-- predates these two columns. Keep that function unchanged and copy the
-- immutable source marker at insert time.
create or replace function public.copy_purchase_request_generated_upload_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.upload_ticket_id is null then
    return new;
  end if;
  select upload.generated_by_system, upload.annual_plan_version_id
  into new.generated_by_system, new.annual_plan_version_id
  from public.purchase_request_upload_tickets upload
  where upload.id = new.upload_ticket_id;
  return new;
end
$function$;

drop trigger if exists purchase_request_attachments_copy_generated_upload on public.purchase_request_attachments;
create trigger purchase_request_attachments_copy_generated_upload
before insert on public.purchase_request_attachments
for each row execute function public.copy_purchase_request_generated_upload_metadata();

-- A plan_page for a plan-backed PR is generated from the indexed annual-plan
-- version. This guard also covers direct service-role callers that bypass the
-- browser/API checks; users can never turn the plan checklist slot back into a
-- manually uploaded PDF.
create or replace function public.require_generated_annual_plan_attachment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_method text;
  generated boolean;
begin
  if new.attachment_kind <> 'plan_page' then
    return new;
  end if;

  select request.purchase_method into request_method
  from public.purchase_requests request
  where request.id = new.purchase_request_id;

  if request_method not in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease') then
    return new;
  end if;

  if new.upload_ticket_id is null then
    raise exception using errcode = '23514', message = 'plan page must be generated from the current annual plan';
  end if;
  select upload.generated_by_system into generated
  from public.purchase_request_upload_tickets upload
  where upload.id = new.upload_ticket_id;
  if not found or generated is distinct from true then
    raise exception using errcode = '23514', message = 'plan page must be generated from the current annual plan';
  end if;
  return new;
end
$function$;

drop trigger if exists purchase_request_attachments_require_generated_plan on public.purchase_request_attachments;
create trigger purchase_request_attachments_require_generated_plan
before insert on public.purchase_request_attachments
for each row execute function public.require_generated_annual_plan_attachment();

create table public.purchase_request_annual_plan_references (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null unique references public.purchase_requests(id) on delete restrict,
  plan_version_id uuid not null references public.lab_stock_annual_plan_versions(id) on delete restrict,
  plan_fiscal_year integer not null check (plan_fiscal_year between 2500 and 3000),
  plan_type text not null default 'procurement' check (plan_type in ('procurement', 'hiring')),
  source_checksum text check (source_checksum is null or source_checksum ~ '^[0-9a-f]{64}$'),
  generated_attachment_id uuid not null references public.purchase_request_attachments(id) on delete restrict,
  contract_name_snapshot text,
  contract_plan_row_id uuid references public.lab_stock_annual_plan_rows(id) on delete restrict,
  contract_plan_line_number integer check (contract_plan_line_number is null or contract_plan_line_number > 0),
  contract_match_method text check (contract_match_method is null or contract_match_method in ('name_exact', 'manual_confirmed')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index purchase_request_annual_plan_references_version_idx
  on public.purchase_request_annual_plan_references (plan_version_id, created_at desc);

create table public.purchase_request_annual_plan_line_references (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.purchase_request_annual_plan_references(id) on delete cascade,
  purchase_request_item_id uuid not null references public.purchase_request_items(id) on delete restrict,
  plan_row_id uuid not null references public.lab_stock_annual_plan_rows(id) on delete restrict,
  plan_line_number integer not null check (plan_line_number > 0),
  match_method text not null check (match_method in ('name_exact', 'code_exact', 'manual_confirmed')),
  created_at timestamptz not null default now(),
  unique (reference_id, purchase_request_item_id),
  unique (reference_id, plan_row_id)
);

create index purchase_request_annual_plan_line_refs_item_idx
  on public.purchase_request_annual_plan_line_references (purchase_request_item_id);

alter table public.lab_stock_annual_plan_versions enable row level security;
alter table public.lab_stock_annual_plan_rows enable row level security;
alter table public.purchase_request_annual_plan_references enable row level security;
alter table public.purchase_request_annual_plan_line_references enable row level security;

revoke all on table public.lab_stock_annual_plan_versions from anon, authenticated;
revoke all on table public.lab_stock_annual_plan_rows from anon, authenticated;
revoke all on table public.purchase_request_annual_plan_references from anon, authenticated;
revoke all on table public.purchase_request_annual_plan_line_references from anon, authenticated;

grant select, insert, update, delete on table public.lab_stock_annual_plan_versions to service_role;
grant select, insert, update, delete on table public.lab_stock_annual_plan_rows to service_role;
grant select, insert, update, delete on table public.purchase_request_annual_plan_references to service_role;
grant select, insert, update, delete on table public.purchase_request_annual_plan_line_references to service_role;

-- Keep the old metadata-only upload RPC coherent during a rolling deploy. It
-- cannot index a PDF by itself, so the version starts pending and the PR form
-- indexes it lazily. New uploads already create the version before changing
-- the pointer, so this trigger is a no-op for the version-aware path.
create or replace function public.sync_lab_stock_annual_plan_version_pointer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  version_id uuid;
begin
  select version.id into version_id
  from public.lab_stock_annual_plan_versions version
  where version.annual_plan_id = new.id
    and version.fiscal_year = new.fiscal_year
    and version.plan_type = new.plan_type
    and version.file_path = new.file_path
  order by version.uploaded_at desc
  limit 1;

  if version_id is null then
    insert into public.lab_stock_annual_plan_versions (
      annual_plan_id, fiscal_year, plan_type, file_path, file_name,
      file_mime_type, file_size_bytes, index_status, uploaded_by, uploaded_at
    ) values (
      new.id, new.fiscal_year, new.plan_type, new.file_path, new.file_name,
      new.file_mime_type, new.file_size_bytes, 'pending', new.uploaded_by,
      new.uploaded_at
    ) returning id into version_id;
  end if;

  new.current_version_id := version_id;
  return new;
end
$function$;

drop trigger if exists lab_stock_annual_plans_sync_version_pointer on public.lab_stock_annual_plans;
create trigger lab_stock_annual_plans_sync_version_pointer
before insert or update of file_path, file_name, file_mime_type, file_size_bytes,
  uploaded_by, uploaded_at, current_version_id
on public.lab_stock_annual_plans
for each row execute function public.sync_lab_stock_annual_plan_version_pointer();

create or replace function public.upsert_lab_stock_annual_plan_with_index(
  p_fiscal_year integer,
  p_plan_type text,
  p_actor_id uuid,
  p_file_path text,
  p_file_name text,
  p_file_mime_type text,
  p_file_size_bytes bigint,
  p_source_checksum text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous_plan public.lab_stock_annual_plans%rowtype;
  updated_plan public.lab_stock_annual_plans%rowtype;
  created_version public.lab_stock_annual_plan_versions%rowtype;
  plan_id uuid;
  current_fiscal_year integer;
  row_payload jsonb;
  row_id uuid;
  row_line_number integer;
  row_sequence text;
  row_item_name text;
  row_ls_code text;
  row_raw_text text;
  row_page_number integer;
  row_page_width numeric;
  row_page_height numeric;
  row_x numeric;
  row_y numeric;
  row_width numeric;
  row_height numeric;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  current_fiscal_year := extract(year from timezone('Asia/Bangkok', now()))::integer
    + case when extract(month from timezone('Asia/Bangkok', now())) >= 10 then 544 else 543 end;
  if p_fiscal_year not in (current_fiscal_year, current_fiscal_year - 1) then
    raise exception using errcode = '22023', message = 'annual plan fiscal year is outside the retention window';
  end if;
  if p_plan_type not in ('procurement', 'hiring') then
    raise exception using errcode = '23514', message = 'unknown annual plan type';
  end if;
  if nullif(btrim(coalesce(p_file_path, '')), '') is null
     or p_file_path like '%..%'
     or p_file_path !~ format('^annual-plans/%s/%s/[^/]+\.pdf$', p_fiscal_year, p_plan_type) then
    raise exception using errcode = '23514', message = 'annual plan file path is invalid';
  end if;
  if nullif(btrim(coalesce(p_file_name, '')), '') is null
     or lower(btrim(coalesce(p_file_mime_type, ''))) <> 'application/pdf'
     or p_file_size_bytes is null
     or p_file_size_bytes not between 1 and 26214400 then
    raise exception using errcode = '22023', message = 'annual plan file metadata is not allowed';
  end if;
  if p_source_checksum is null or p_source_checksum !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'annual plan checksum is invalid';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'annual plan must contain searchable rows';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = '22023', message = 'annual plan must contain searchable rows';
  end if;
  if jsonb_array_length(p_rows) > 20000 then
    raise exception using errcode = '22023', message = 'annual plan contains too many rows';
  end if;

  perform pg_advisory_xact_lock(hashtext(format('%s:%s', p_fiscal_year, p_plan_type)));

  select * into previous_plan
  from public.lab_stock_annual_plans plan
  where plan.fiscal_year = p_fiscal_year and plan.plan_type = p_plan_type
  for update;
  plan_id := coalesce(previous_plan.id, gen_random_uuid());

  insert into public.lab_stock_annual_plan_versions (
    annual_plan_id, fiscal_year, plan_type, file_path, file_name,
    file_mime_type, file_size_bytes, source_checksum, index_status, uploaded_by
  ) values (
    plan_id, p_fiscal_year, p_plan_type,
    btrim(p_file_path), btrim(p_file_name), lower(btrim(p_file_mime_type)),
    p_file_size_bytes, lower(p_source_checksum), 'ready', p_actor_id
  ) returning * into created_version;

  for row_payload in select value from jsonb_array_elements(p_rows)
  loop
    begin
      row_id := coalesce((row_payload ->> 'id')::uuid, gen_random_uuid());
      row_line_number := (row_payload ->> 'lineNumber')::integer;
      row_sequence := btrim(row_payload ->> 'planSequence');
      row_item_name := btrim(row_payload ->> 'itemName');
      row_ls_code := nullif(btrim(coalesce(row_payload ->> 'lsCode', '')), '');
      row_raw_text := btrim(row_payload ->> 'rawText');
      row_page_number := (row_payload ->> 'pageNumber')::integer;
      row_page_width := (row_payload ->> 'pageWidth')::numeric;
      row_page_height := (row_payload ->> 'pageHeight')::numeric;
      row_x := (row_payload ->> 'x')::numeric;
      row_y := (row_payload ->> 'y')::numeric;
      row_width := (row_payload ->> 'width')::numeric;
      row_height := (row_payload ->> 'height')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'annual plan row is invalid';
    end;
    if row_line_number is null or row_line_number < 1
       or nullif(row_sequence, '') is null
       or nullif(row_item_name, '') is null
       or nullif(row_raw_text, '') is null
       or row_page_number is null or row_page_number < 1
       or row_page_width is null or row_page_width <= 0
       or row_page_height is null or row_page_height <= 0
       or row_x is null or row_x < 0
       or row_y is null or row_y < 0
       or row_width is null or row_width <= 0
       or row_height is null or row_height <= 0 then
      raise exception using errcode = '22023', message = 'annual plan row is invalid';
    end if;

    insert into public.lab_stock_annual_plan_rows (
      id, annual_plan_version_id, line_number, plan_sequence, item_name,
      ls_code, raw_text, page_number, page_width, page_height, x, y, width, height
    ) values (
      row_id, created_version.id, row_line_number, row_sequence, row_item_name,
      row_ls_code, row_raw_text, row_page_number, row_page_width, row_page_height,
      row_x, row_y, row_width, row_height
    );
  end loop;

  if previous_plan.id is not null then
    insert into public.lab_stock_annual_plan_audit (
      plan_id, fiscal_year, plan_type, action, file_path, file_name,
      file_mime_type, file_size_bytes, actor_id
    ) values (
      previous_plan.id, previous_plan.fiscal_year, previous_plan.plan_type, 'replaced',
      previous_plan.file_path, previous_plan.file_name, previous_plan.file_mime_type,
      previous_plan.file_size_bytes, p_actor_id
    );

    update public.lab_stock_annual_plans
    set file_path = btrim(p_file_path), file_name = btrim(p_file_name),
        file_mime_type = lower(btrim(p_file_mime_type)), file_size_bytes = p_file_size_bytes,
        uploaded_by = p_actor_id, uploaded_at = now(), current_version_id = created_version.id
    where id = previous_plan.id
    returning * into updated_plan;
  else
    insert into public.lab_stock_annual_plans (
      id, fiscal_year, plan_type, file_path, file_name, file_mime_type,
      file_size_bytes, uploaded_by, current_version_id
    ) values (
      plan_id, p_fiscal_year, p_plan_type, btrim(p_file_path), btrim(p_file_name),
      lower(btrim(p_file_mime_type)), p_file_size_bytes, p_actor_id, created_version.id
    ) returning * into updated_plan;
  end if;

  insert into public.lab_stock_annual_plan_audit (
    plan_id, fiscal_year, plan_type, action, file_path, file_name,
    file_mime_type, file_size_bytes, actor_id
  ) values (
    updated_plan.id, updated_plan.fiscal_year, updated_plan.plan_type,
    case when previous_plan.id is null then 'uploaded' else 'replaced' end,
    updated_plan.file_path, updated_plan.file_name, updated_plan.file_mime_type,
    updated_plan.file_size_bytes, p_actor_id
  );

  return jsonb_build_object(
    'id', updated_plan.id,
    'version_id', created_version.id,
    'fiscal_year', updated_plan.fiscal_year,
    'plan_type', updated_plan.plan_type,
    'file_path', updated_plan.file_path,
    'file_name', updated_plan.file_name,
    'file_mime_type', updated_plan.file_mime_type,
    'file_size_bytes', updated_plan.file_size_bytes,
    'uploaded_by', updated_plan.uploaded_by,
    'uploaded_at', updated_plan.uploaded_at,
    'source_checksum', created_version.source_checksum,
    'previous_file_path', case when previous_plan.id is null then null else previous_plan.file_path end
  );
end
$function$;

create or replace function public.register_purchase_request_annual_plan_upload(
  p_actor_id uuid,
  p_upload_session_id uuid,
  p_storage_key text,
  p_file_name text,
  p_size_bytes bigint,
  p_expires_at timestamptz,
  p_plan_version_id uuid
)
returns public.purchase_request_upload_tickets
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  ticket public.purchase_request_upload_tickets%rowtype;
  current_fiscal_year integer;
begin
  current_fiscal_year := extract(year from timezone('Asia/Bangkok', now()))::integer
    + case when extract(month from timezone('Asia/Bangkok', now())) >= 10 then 544 else 543 end;
  if not exists (
    select 1
    from public.lab_stock_annual_plan_versions version
    join public.lab_stock_annual_plans plan on plan.current_version_id = version.id
    where version.id = p_plan_version_id
      and version.fiscal_year = current_fiscal_year
      and version.index_status = 'ready'
  ) then
    raise exception using errcode = '55000', message = 'annual plan version is no longer current';
  end if;

  ticket := public.register_purchase_request_checklist_upload(
    p_actor_id, p_upload_session_id, 'plan_page', 1, p_storage_key,
    p_file_name, 'application/pdf', p_size_bytes, p_expires_at
  );
  update public.purchase_request_upload_tickets upload
  set generated_by_system = true, annual_plan_version_id = p_plan_version_id
  where upload.id = ticket.id
  returning * into ticket;
  return ticket;
end
$function$;

create or replace function public.apply_purchase_request_annual_plan_reference(
  p_pr_id uuid,
  p_actor_id uuid,
  p_reference jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_request public.purchase_requests%rowtype;
  plan_version public.lab_stock_annual_plan_versions%rowtype;
  plan_pointer public.lab_stock_annual_plans%rowtype;
  generated_attachment_id uuid;
  reference_id uuid;
  source_checksum text;
  plan_fiscal_year integer;
  plan_version_id uuid;
  current_fiscal_year integer;
  reference_line jsonb;
  item_row public.purchase_request_items%rowtype;
  plan_row public.lab_stock_annual_plan_rows%rowtype;
  reference_index integer := 0;
  plan_row_id uuid;
  plan_line_number integer;
  match_method text;
  expected_item_count integer;
  actual_item_name text;
  actual_item_ls_code text;
  expected_plan_type text;
  contract_reference jsonb;
  contract_name text;
  contract_plan_row_id uuid;
  contract_plan_line_number integer;
  contract_match_method text;
  actual_contract_name text;
begin
  select request.* into target_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'purchase request not found'; end if;
  perform public.assert_purchase_request_manager(p_actor_id, target_request.requester_id);

  if p_reference is null then
    if target_request.purchase_method in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease') then
      raise exception using errcode = '23514', message = 'annual-plan purchase requests need a plan reference';
    end if;
    delete from public.purchase_request_annual_plan_references reference
    where reference.purchase_request_id = p_pr_id;
    update public.purchase_requests
    set annual_plan_reference_required = false, updated_by = p_actor_id
    where id = p_pr_id;
    return jsonb_build_object('id', p_pr_id, 'referenced', false);
  end if;
  if target_request.purchase_method not in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease') then
    raise exception using errcode = '23514', message = 'annual plan reference is not supported for this purchase method';
  end if;
  expected_plan_type := case when target_request.purchase_method = 'equipment_lease' then 'hiring' else 'procurement' end;
  if jsonb_typeof(p_reference) <> 'object'
     or jsonb_typeof(p_reference -> 'lines') <> 'array' then
    raise exception using errcode = '22023', message = 'annual plan reference is invalid';
  end if;

  current_fiscal_year := extract(year from timezone('Asia/Bangkok', now()))::integer
    + case when extract(month from timezone('Asia/Bangkok', now())) >= 10 then 544 else 543 end;
  if (
    extract(year from target_request.requested_date)::integer
    + case when extract(month from target_request.requested_date) >= 10 then 544 else 543 end
  ) <> current_fiscal_year then
    raise exception using errcode = '22023', message = 'annual-plan purchase request date must be in the current fiscal year';
  end if;

  begin
    plan_fiscal_year := (p_reference ->> 'planFiscalYear')::integer;
    plan_version_id := (p_reference ->> 'planVersionId')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'annual plan reference identifiers are invalid';
  end;
  if (p_reference ->> 'planType') is distinct from expected_plan_type then
    raise exception using errcode = '23514', message = 'annual plan type does not match the purchase method';
  end if;
  if plan_fiscal_year is distinct from current_fiscal_year then
    raise exception using errcode = '22023', message = 'annual plan reference is not for the current fiscal year';
  end if;

  select * into plan_pointer
  from public.lab_stock_annual_plans plan
  where plan.fiscal_year = current_fiscal_year and plan.plan_type = expected_plan_type
  for update;
  if not found or plan_pointer.current_version_id is null
     or plan_pointer.current_version_id is distinct from plan_version_id then
    raise exception using errcode = '55000', message = 'annual plan file changed; rematch the PR lines';
  end if;
  select * into plan_version
  from public.lab_stock_annual_plan_versions version
  where version.id = plan_pointer.current_version_id
    and version.fiscal_year = current_fiscal_year
    and version.plan_type = expected_plan_type
    and version.index_status = 'ready';
  if not found then raise exception using errcode = '55000', message = 'annual plan index is not ready'; end if;
  source_checksum := plan_version.source_checksum;

  select count(*) into expected_item_count
  from public.purchase_request_items item
  where item.purchase_request_id = p_pr_id;
  if expected_plan_type = 'procurement' and jsonb_array_length(p_reference -> 'lines') <> expected_item_count then
    raise exception using errcode = '23514', message = 'annual plan reference line count does not match the PR';
  end if;
  if expected_plan_type = 'hiring' then
    if expected_item_count <> 0 or jsonb_array_length(p_reference -> 'lines') <> 0 then
      raise exception using errcode = '23514', message = 'hiring-plan lease requests cannot contain purchase item references';
    end if;
    contract_reference := p_reference -> 'contract';
    if jsonb_typeof(contract_reference) <> 'object' then
      raise exception using errcode = '22023', message = 'hiring plan reference must contain a contract name';
    end if;
    contract_name := nullif(btrim(contract_reference ->> 'contractName'), '');
    actual_contract_name := nullif(btrim(target_request.method_details -> 'contractDraft' ->> 'displayName'), '');
    if contract_name is null or actual_contract_name is null
       or lower(regexp_replace(contract_name, '\s+', ' ', 'g'))
          <> lower(regexp_replace(actual_contract_name, '\s+', ' ', 'g')) then
      raise exception using errcode = '23514', message = 'hiring plan contract name does not match the PR';
    end if;
    begin
      contract_plan_row_id := (contract_reference -> 'line' ->> 'planRowId')::uuid;
      contract_plan_line_number := (contract_reference -> 'line' ->> 'lineNumber')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'hiring plan contract row reference is invalid';
    end;
    contract_match_method := contract_reference -> 'line' ->> 'matchMethod';
    if contract_plan_row_id is null or contract_plan_line_number is null
        or contract_plan_line_number < 1
        or contract_match_method is null
        or contract_match_method not in ('name_exact', 'manual_confirmed') then
      raise exception using errcode = '22023', message = 'hiring plan contract row reference is invalid';
    end if;
    select row.* into plan_row
    from public.lab_stock_annual_plan_rows row
    where row.id = contract_plan_row_id
      and row.annual_plan_version_id = plan_version.id
      and row.line_number = contract_plan_line_number;
    if not found then
      raise exception using errcode = '23503', message = 'hiring plan row is not part of the current version';
    end if;
    if position(lower(regexp_replace(contract_name, '\s+', ' ', 'g')) in lower(regexp_replace(plan_row.item_name, '\s+', ' ', 'g'))) = 0
       and position(lower(regexp_replace(plan_row.item_name, '\s+', ' ', 'g')) in lower(regexp_replace(contract_name, '\s+', ' ', 'g'))) = 0
       and position(lower(regexp_replace(contract_name, '\s+', ' ', 'g')) in lower(regexp_replace(plan_row.raw_text, '\s+', ' ', 'g'))) = 0 then
      raise exception using errcode = '23514', message = 'hiring plan row is not related to the contract name';
    end if;
  end if;

  select attachment.id into generated_attachment_id
  from public.purchase_request_attachments attachment
  join public.purchase_request_upload_tickets upload on upload.id = attachment.upload_ticket_id
  where attachment.purchase_request_id = p_pr_id
    and attachment.attachment_kind = 'plan_page'
    and attachment.slot = 1
    and attachment.deleted_at is null
    and attachment.generated_by_system
    and attachment.annual_plan_version_id = plan_version.id
    and upload.generated_by_system
    and upload.annual_plan_version_id = plan_version.id
  order by attachment.uploaded_at desc
  limit 1;
  if generated_attachment_id is null then
    raise exception using errcode = '23514', message = 'annual plan highlight evidence is required';
  end if;

  delete from public.purchase_request_annual_plan_references reference
  where reference.purchase_request_id = p_pr_id;
  insert into public.purchase_request_annual_plan_references (
    purchase_request_id, plan_version_id, plan_fiscal_year, plan_type, source_checksum,
    generated_attachment_id, contract_name_snapshot, contract_plan_row_id,
    contract_plan_line_number, contract_match_method, created_by
  ) values (
    p_pr_id, plan_version.id, current_fiscal_year, expected_plan_type, source_checksum,
    generated_attachment_id, contract_name, contract_plan_row_id,
    contract_plan_line_number, contract_match_method, p_actor_id
  ) returning id into reference_id;

  if expected_plan_type = 'procurement' then
    for item_row in
    select item.*
    from public.purchase_request_items item
    where item.purchase_request_id = p_pr_id
    order by item.line_number
    loop
      reference_index := reference_index + 1;
      reference_line := p_reference -> 'lines' -> (reference_index - 1);
      begin
        plan_row_id := (reference_line ->> 'planRowId')::uuid;
        plan_line_number := (reference_line ->> 'lineNumber')::integer;
      exception when others then
        raise exception using errcode = '22023', message = 'annual plan line reference is invalid';
      end;
      match_method := reference_line ->> 'matchMethod';
      if match_method is null or match_method not in ('name_exact', 'code_exact', 'manual_confirmed') then
        raise exception using errcode = '22023', message = 'annual plan match method is invalid';
      end if;
      select row.* into plan_row
      from public.lab_stock_annual_plan_rows row
      where row.id = plan_row_id and row.annual_plan_version_id = plan_version.id
        and row.line_number = plan_line_number;
      if not found then
        raise exception using errcode = '23503', message = 'annual plan row is not part of the current version';
      end if;

    -- The PR payload is client input. Re-read the catalogue identity created
    -- or selected by the base PR RPC before accepting a plan match, including
    -- for a newly-created catalogue line.
      select inventory_item.name, inventory_item.ls_code
      into actual_item_name, actual_item_ls_code
      from public.inventory_items inventory_item
      where inventory_item.id = item_row.inventory_item_id;
      if not found then
        raise exception using errcode = '23503', message = 'purchase request inventory item is not available';
      end if;

      if match_method = 'name_exact'
         and position(lower(btrim(actual_item_name)) in lower(plan_row.item_name)) = 0
         and position(lower(btrim(plan_row.item_name)) in lower(actual_item_name)) = 0
         and position(lower(btrim(actual_item_name)) in lower(plan_row.raw_text)) = 0 then
        raise exception using errcode = '23514', message = 'annual plan name does not match the catalogue item';
      end if;
      if match_method = 'name_exact'
         and actual_item_ls_code is not null
         and plan_row.ls_code is not null
         and upper(regexp_replace(actual_item_ls_code, '[^a-zA-Z0-9]', '', 'g'))
             <> upper(regexp_replace(plan_row.ls_code, '[^a-zA-Z0-9]', '', 'g')) then
        raise exception using errcode = '23514', message = 'annual plan LS code does not confirm the catalogue item';
      end if;
      if match_method = 'code_exact'
         and (
           actual_item_ls_code is null
           or upper(regexp_replace(actual_item_ls_code, '[^a-zA-Z0-9]', '', 'g'))
              <> upper(regexp_replace(coalesce(plan_row.ls_code, ''), '[^a-zA-Z0-9]', '', 'g'))
         ) then
        raise exception using errcode = '23514', message = 'annual plan LS code does not match the catalogue item';
      end if;
      if match_method = 'manual_confirmed'
         and position(lower(btrim(actual_item_name)) in lower(plan_row.item_name)) = 0
         and position(lower(btrim(plan_row.item_name)) in lower(actual_item_name)) = 0
         and position(lower(btrim(actual_item_name)) in lower(plan_row.raw_text)) = 0
         and (
           actual_item_ls_code is null
           or plan_row.ls_code is null
           or upper(regexp_replace(actual_item_ls_code, '[^a-zA-Z0-9]', '', 'g'))
              <> upper(regexp_replace(plan_row.ls_code, '[^a-zA-Z0-9]', '', 'g'))
         ) then
        raise exception using errcode = '23514', message = 'annual plan row is not related to the catalogue item';
      end if;
      insert into public.purchase_request_annual_plan_line_references (
        reference_id, purchase_request_item_id, plan_row_id, plan_line_number, match_method
      ) values (
        reference_id, item_row.id, plan_row.id, plan_row.line_number, match_method
      );
    end loop;
  end if;

  if expected_plan_type = 'procurement' then
    update public.purchase_requests request
    set annual_plan_reference_required = true,
        method_details = jsonb_set(
          jsonb_set(request.method_details, '{fiscalYear}', to_jsonb(current_fiscal_year), true),
          '{planSequence}',
          to_jsonb((
            select string_agg(row.plan_sequence, ', ' order by item.line_number)
            from public.purchase_request_annual_plan_line_references reference_line
            join public.purchase_request_items item on item.id = reference_line.purchase_request_item_id
            join public.lab_stock_annual_plan_rows row on row.id = reference_line.plan_row_id
            where reference_line.reference_id = reference_id
          )),
          true
        ),
        updated_by = p_actor_id
    where request.id = p_pr_id;
  else
    update public.purchase_requests
    set annual_plan_reference_required = true, updated_by = p_actor_id
    where id = p_pr_id;
  end if;

  return jsonb_build_object(
    'id', p_pr_id,
    'referenced', true,
    'planVersionId', plan_version.id,
    'planFiscalYear', current_fiscal_year,
    'planType', expected_plan_type,
    'generatedAttachmentId', generated_attachment_id
  );
end
$function$;

create or replace function public.enforce_current_annual_plan_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.purchase_method in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease')
     and new.checklist_policy_version is not null
     and new.annual_plan_reference_required
     and not exists (
       select 1
       from public.purchase_request_annual_plan_references reference
       where reference.purchase_request_id = new.id
     ) then
     raise exception using errcode = '23514', message = 'new annual-plan purchase requests need a plan reference';
  end if;
  return new;
end
$function$;

drop trigger if exists purchase_requests_current_annual_plan_reference on public.purchase_requests;
create constraint trigger purchase_requests_current_annual_plan_reference
after insert or update of purchase_method, checklist_policy_version, annual_plan_reference_required
on public.purchase_requests
deferrable initially deferred
for each row execute function public.enforce_current_annual_plan_reference();

create or replace function public.create_purchase_request_with_annual_plan_checklist(
  p_actor_id uuid,
  p_request jsonb,
  p_items jsonb,
  p_upload_session_id uuid,
  p_attachments jsonb,
  p_committees jsonb,
  p_annual_plan_reference jsonb
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_request public.purchase_requests%rowtype;
begin
  created_request := public.create_purchase_request_with_checklist(
    p_actor_id, p_request, p_items, p_upload_session_id, p_attachments, p_committees
  );
  update public.purchase_requests request
   set annual_plan_reference_required = ((p_request -> 'method' ->> 'kind') in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease'))
  where request.id = created_request.id;
  perform public.apply_purchase_request_annual_plan_reference(
    created_request.id, p_actor_id, p_annual_plan_reference
  );
  select request.* into created_request from public.purchase_requests request where request.id = created_request.id;
  return created_request;
end
$function$;

create or replace function public.update_purchase_request_with_annual_plan_checklist(
  p_pr_id uuid,
  p_actor_id uuid,
  p_request jsonb,
  p_items jsonb,
  p_upload_session_id uuid,
  p_attachments jsonb,
  p_committees jsonb,
  p_annual_plan_reference jsonb
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_request public.purchase_requests%rowtype;
begin
  updated_request := public.update_purchase_request_with_checklist(
    p_pr_id, p_actor_id, p_request, p_items, p_upload_session_id, p_attachments, p_committees
  );
  update public.purchase_requests request
   set annual_plan_reference_required = ((p_request -> 'method' ->> 'kind') in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease'))
  where request.id = p_pr_id;
  perform public.apply_purchase_request_annual_plan_reference(
    p_pr_id, p_actor_id, p_annual_plan_reference
  );
  select request.* into updated_request from public.purchase_requests request where request.id = p_pr_id;
  return updated_request;
end
$function$;

revoke execute on function public.copy_purchase_request_generated_upload_metadata() from public, anon, authenticated;
revoke execute on function public.require_generated_annual_plan_attachment() from public, anon, authenticated;
revoke execute on function public.upsert_lab_stock_annual_plan_with_index(integer, text, uuid, text, text, text, bigint, text, jsonb) from public, anon, authenticated;
revoke execute on function public.register_purchase_request_annual_plan_upload(uuid, uuid, text, text, bigint, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.apply_purchase_request_annual_plan_reference(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.enforce_current_annual_plan_reference() from public, anon, authenticated;
revoke execute on function public.create_purchase_request_with_annual_plan_checklist(uuid, jsonb, jsonb, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.update_purchase_request_with_annual_plan_checklist(uuid, uuid, jsonb, jsonb, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.upsert_lab_stock_annual_plan_with_index(integer, text, uuid, text, text, text, bigint, text, jsonb) to service_role;
grant execute on function public.register_purchase_request_annual_plan_upload(uuid, uuid, text, text, bigint, timestamptz, uuid) to service_role;
grant execute on function public.apply_purchase_request_annual_plan_reference(uuid, uuid, jsonb) to service_role;
grant execute on function public.create_purchase_request_with_annual_plan_checklist(uuid, jsonb, jsonb, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.update_purchase_request_with_annual_plan_checklist(uuid, uuid, jsonb, jsonb, uuid, jsonb, jsonb, jsonb) to service_role;

commit;
