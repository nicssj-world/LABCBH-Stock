-- Forward-only service-procurement workflow.
-- Purchase (inventory) tables and RPCs are intentionally not changed here.
begin;

alter table public.service_procurement_plans
  add column if not exists is_red_cross boolean not null default false,
  add column if not exists requires_contract boolean not null default false,
  add column if not exists status text not null default 'active',
  add column if not exists closed_at timestamptz;

do $plan_status$begin
  alter table public.service_procurement_plans drop constraint if exists service_procurement_plans_status_check;
  alter table public.service_procurement_plans add constraint service_procurement_plans_status_check
    check (status in ('active', 'closing', 'closed'));
end$plan_status$;

create table if not exists public.service_plan_test_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.service_procurement_plans(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  name text not null check (nullif(btrim(name), '') is not null),
  unit text not null check (nullif(btrim(unit), '') is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, line_number),
  unique (plan_id, name, unit)
);
create index if not exists service_plan_test_items_plan_idx
  on public.service_plan_test_items(plan_id, line_number);

create table if not exists public.service_plan_documents (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.service_procurement_plans(id) on delete restrict,
  document_kind text not null check (document_kind in ('quotation', 'contract_page')),
  storage_key text not null unique check (storage_key like 'service-procurement/plan-document/%' and storage_key not like '%..%'),
  file_name text not null check (nullif(btrim(file_name), '') is not null),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  checksum text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  unique (plan_id, document_kind)
);
create index if not exists service_plan_documents_plan_idx
  on public.service_plan_documents(plan_id, document_kind);

create table if not exists public.service_plan_document_audit (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.service_procurement_plans(id) on delete cascade,
  document_kind text not null check (document_kind in ('quotation', 'contract_page')),
  action text not null check (action in ('attached', 'replaced', 'deleted')),
  previous_storage_key text,
  storage_key text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.service_plan_document_audit
  add column if not exists previous_storage_key text;
create index if not exists service_plan_document_audit_plan_idx
  on public.service_plan_document_audit(plan_id, created_at desc);

alter table public.service_purchase_requests
  add column if not exists usage_start_date date,
  add column if not exists usage_end_date date;
update public.service_purchase_requests
set usage_start_date = coalesce(usage_start_date, requested_po_month, requested_date),
    usage_end_date = coalesce(usage_end_date, requested_po_month, requested_date)
where usage_start_date is null or usage_end_date is null;
alter table public.service_purchase_requests
  alter column usage_start_date set not null,
  alter column usage_end_date set not null;

do $request_constraints$begin
  -- Legacy Out Lab rows are now represented by the single laboratory-testing
  -- workflow; this keeps historical records readable while removing the
  -- annual-items branch for every new write.
  update public.service_purchase_requests
  set purchase_method = 'laboratory_testing'
  where purchase_method <> 'laboratory_testing';
  alter table public.service_purchase_requests drop constraint if exists service_purchase_requests_purchase_method_check;
  alter table public.service_purchase_requests add constraint service_purchase_requests_purchase_method_check
    check (purchase_method = 'laboratory_testing');
  alter table public.service_purchase_requests drop constraint if exists service_purchase_requests_status_axis_check;
  alter table public.service_purchase_requests add constraint service_purchase_requests_status_axis_check
    check (
      (status = 'pending' and po_status = 'not_issued')
      or (status = 'confirmed' and po_status in ('not_issued', 'open'))
      or (status = 'closed' and po_status = 'closed')
      or (status = 'cancelled' and po_status = 'cancelled')
    );
  if not exists (select 1 from public.service_purchase_requests where plan_id is null) then
    alter table public.service_purchase_requests alter column plan_id set not null;
  end if;
end$request_constraints$;

-- Keep legacy unlinked rows readable, but never allow a new service PR (or a
-- new edit that clears the reference) to bypass a plan.
create or replace function public.service_procurement_require_plan_reference()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if new.plan_id is null then
    raise exception using errcode = '23514', message = 'service purchase request requires a referenced plan';
  end if;
  return new;
end
$function$;
revoke execute on function public.service_procurement_require_plan_reference() from public, anon, authenticated;
drop trigger if exists service_purchase_requests_plan_reference_guard on public.service_purchase_requests;
create trigger service_purchase_requests_plan_reference_guard
before insert or update of plan_id on public.service_purchase_requests
for each row execute function public.service_procurement_require_plan_reference();

alter table public.service_purchase_request_items
  add column if not exists plan_item_id uuid references public.service_plan_test_items(id) on delete set null;
alter table public.service_purchase_request_items
  alter column inventory_item_id drop not null,
  alter column ls_code drop not null;
alter table public.service_purchase_request_items
  drop constraint if exists service_purchase_request_items_requested_quantity_check;
alter table public.service_purchase_request_items
  add constraint service_purchase_request_items_requested_quantity_check check (requested_quantity >= 0);
create index if not exists service_purchase_request_items_plan_item_idx
  on public.service_purchase_request_items(plan_item_id);

-- New service PRs store Red Cross test lines in a dedicated snapshot table.
-- It deliberately has no inventory_items/LS relationship; the older item
-- table remains only for historical rows and legacy RPC compatibility.
create table if not exists public.service_purchase_request_test_item_snapshots (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  plan_item_id uuid,
  line_number integer not null check (line_number > 0),
  name text not null check (nullif(btrim(name), '') is not null),
  unit text not null check (nullif(btrim(unit), '') is not null),
  requested_quantity numeric(15,3) not null check (requested_quantity >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_request_id, line_number)
);
create index if not exists service_purchase_request_test_item_snapshots_request_idx
  on public.service_purchase_request_test_item_snapshots(purchase_request_id, line_number);
drop trigger if exists service_purchase_request_test_item_snapshots_append_only on public.service_purchase_request_test_item_snapshots;
create trigger service_purchase_request_test_item_snapshots_append_only
before update or delete on public.service_purchase_request_test_item_snapshots
for each row execute function public.service_procurement_prevent_ledger_mutation();

drop index if exists public.service_lab_primary_expense_key;

create table if not exists public.service_purchase_request_expenses (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  expense_date date not null,
  -- Generated expressions must be immutable; derive the first day arithmetically.
  expense_month date generated always as (
    expense_date - (extract(day from expense_date)::integer - 1)
  ) stored,
  amount numeric(17,2) not null check (amount > 0),
  invoice_number text,
  note text,
  frequency text not null default 'monthly' check (frequency in ('monthly', 'daily')),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_purchase_request_expenses_request_idx
  on public.service_purchase_request_expenses(purchase_request_id, expense_date desc);
create unique index if not exists service_purchase_request_expenses_month_unique
  on public.service_purchase_request_expenses(purchase_request_id, expense_month)
  where status = 'active' and frequency = 'monthly';
create unique index if not exists service_purchase_request_expenses_invoice_unique
  on public.service_purchase_request_expenses(purchase_request_id, lower(btrim(invoice_number)))
  where status = 'active' and nullif(btrim(invoice_number), '') is not null;

create table if not exists public.service_purchase_request_expense_audits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.service_purchase_request_expenses(id) on delete restrict,
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  action text not null check (action in ('created', 'updated', 'cancelled')),
  before_data jsonb,
  after_data jsonb,
  reason text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists service_purchase_request_expense_audits_request_idx
  on public.service_purchase_request_expense_audits(purchase_request_id, created_at desc);

create or replace function public.service_procurement_set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin new.updated_at := now(); return new; end
$function$;
drop trigger if exists service_plan_test_items_updated_at on public.service_plan_test_items;
create trigger service_plan_test_items_updated_at before update on public.service_plan_test_items
for each row execute function public.service_procurement_set_updated_at();
drop trigger if exists service_purchase_request_expenses_updated_at on public.service_purchase_request_expenses;
create trigger service_purchase_request_expenses_updated_at before update on public.service_purchase_request_expenses
for each row execute function public.service_procurement_set_updated_at();
drop trigger if exists service_plan_document_audit_append_only on public.service_plan_document_audit;
create trigger service_plan_document_audit_append_only before update or delete on public.service_plan_document_audit
for each row execute function public.service_procurement_prevent_ledger_mutation();
drop trigger if exists service_purchase_request_expense_audit_append_only on public.service_purchase_request_expense_audits;
create trigger service_purchase_request_expense_audit_append_only before update or delete on public.service_purchase_request_expense_audits
for each row execute function public.service_procurement_prevent_ledger_mutation();

alter table public.service_plan_test_items enable row level security;
alter table public.service_plan_documents enable row level security;
alter table public.service_plan_document_audit enable row level security;
alter table public.service_purchase_request_expenses enable row level security;
alter table public.service_purchase_request_expense_audits enable row level security;
alter table public.service_purchase_request_test_item_snapshots enable row level security;
revoke all on table public.service_plan_test_items, public.service_plan_documents,
  public.service_plan_document_audit, public.service_purchase_request_expenses,
  public.service_purchase_request_expense_audits, public.service_purchase_request_test_item_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.service_plan_test_items,
  public.service_plan_documents, public.service_plan_document_audit,
  public.service_purchase_request_expenses, public.service_purchase_request_expense_audits,
  public.service_purchase_request_test_item_snapshots to service_role;
grant select on table public.service_plan_test_items, public.service_plan_documents,
  public.service_purchase_request_expenses, public.service_purchase_request_expense_audits,
  public.service_purchase_request_test_item_snapshots to authenticated;

do $new_policies$
declare table_name text;
begin
  foreach table_name in array array['service_plan_test_items', 'service_plan_documents', 'service_plan_document_audit', 'service_purchase_request_expenses', 'service_purchase_request_expense_audits', 'service_purchase_request_test_item_snapshots'] loop
    execute format('drop policy if exists %I_app_read on public.%I', table_name, table_name);
    execute format($policy$
      create policy %1$I_app_read on public.%1$I for select to authenticated using (
        exists (select 1 from public.profiles profile where profile.id = (select auth.uid()) and profile.status = 'active' and profile.deleted_at is null)
      )
    $policy$, table_name);
  end loop;
end
$new_policies$;

-- Expense entry is intentionally narrower than PO operations: a stock officer
-- may attach PO evidence, but may not record or close a PO unless also named as
-- the requester or an assigned plan responsible.
create or replace function public.service_procurement_assert_actor(
  p_actor_id uuid,
  p_scope text,
  p_plan_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.status = 'active' and profile.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'service procurement actor is not active';
  end if;

  if p_scope = 'plan_admin'
    and not (public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or public.service_procurement_actor_has_role(p_actor_id, 'stock_officer')) then
    raise exception using errcode = '42501', message = 'only admin or stock officers may manage service plans';
  elsif p_scope = 'requester'
    and not (public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or public.service_procurement_actor_has_role(p_actor_id, 'head')) then
    raise exception using errcode = '42501', message = 'only admin or heads may create service purchase requests';
  elsif p_scope = 'stock'
    and not (public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or public.service_procurement_actor_has_role(p_actor_id, 'stock_officer')) then
    raise exception using errcode = '42501', message = 'only admin or stock officers may operate service POs';
  elsif p_scope = 'recorder'
    and not (
      public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or exists (
        select 1 from public.service_plan_responsibles responsible
        join public.profiles profile on profile.id = responsible.profile_id
        where responsible.plan_id = p_plan_id and responsible.profile_id = p_actor_id
          and profile.status = 'active' and profile.deleted_at is null
      )
    ) then
    raise exception using errcode = '42501', message = 'actor is not a service plan responsible';
  elsif p_scope = 'request_recorder'
    and not (
      public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or exists (
        select 1 from public.service_purchase_requests request
        join public.profiles requester_profile on requester_profile.id = request.requester_id
        where request.id = p_plan_id and request.requester_id = p_actor_id
          and requester_profile.status = 'active' and requester_profile.deleted_at is null
      )
      or exists (
        select 1
        from public.service_purchase_requests request
        join public.service_plan_responsibles responsible on responsible.plan_id = request.plan_id
        join public.profiles responsible_profile on responsible_profile.id = responsible.profile_id
        where request.id = p_plan_id and responsible.profile_id = p_actor_id
          and responsible_profile.status = 'active' and responsible_profile.deleted_at is null
      )
    ) then
    raise exception using errcode = '42501', message = 'actor is not allowed to record this service request';
  end if;
end
$function$;
revoke execute on function public.service_procurement_assert_actor(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.service_procurement_assert_actor(uuid, text, uuid) to service_role;

-- The plan document pointer is changed inside the same RPC transaction. The
-- caller deletes oldStorageKey after commit and queues a retry if deletion
-- fails; audit rows remain append-only.
create or replace function public.upsert_service_plan_document(
  p_actor_id uuid, p_plan_id uuid, p_document_kind text, p_storage_key text,
  p_file_name text, p_mime_type text, p_size_bytes bigint, p_checksum text
)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  plan_row public.service_procurement_plans%rowtype;
  old_row public.service_plan_documents%rowtype;
  next_row public.service_plan_documents%rowtype;
begin
  if not (public.service_procurement_actor_has_role(p_actor_id, 'admin')
    or public.service_procurement_actor_has_role(p_actor_id, 'head')
    or public.service_procurement_actor_has_role(p_actor_id, 'stock_officer')) then
    raise exception using errcode = '42501', message = 'ไม่มีสิทธิ์แนบเอกสารแผนงานจ้าง';
  end if;
  if p_document_kind not in ('quotation', 'contract_page')
    or p_storage_key is null or p_storage_key not like ('service-procurement/plan-document/' || p_plan_id::text || '/%')
    or p_storage_key like '%..%' then
    raise exception using errcode = '22023', message = 'ข้อมูลเอกสารแผนงานจ้างไม่ถูกต้อง';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or p_size_bytes < 1 or p_size_bytes > 20971520 then
    raise exception using errcode = '22023', message = 'ชนิดหรือขนาดเอกสารแผนงานจ้างไม่ถูกต้อง';
  end if;
  select * into plan_row from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  if plan_row.status <> 'active' then raise exception using errcode = '55000', message = 'only active service plans can change documents'; end if;
  if p_document_kind = 'contract_page' and not plan_row.requires_contract then
    raise exception using errcode = '22023', message = 'contract page is allowed only for plans that require a contract';
  end if;
  select * into old_row from public.service_plan_documents
    where plan_id = p_plan_id and document_kind = p_document_kind for update;
  insert into public.service_plan_documents (
    plan_id, document_kind, storage_key, file_name, mime_type, size_bytes, checksum, uploaded_by
  ) values (
    p_plan_id, p_document_kind, p_storage_key, btrim(p_file_name), p_mime_type, p_size_bytes, p_checksum, p_actor_id
  ) on conflict (plan_id, document_kind) do update set
    storage_key = excluded.storage_key, file_name = excluded.file_name,
    mime_type = excluded.mime_type, size_bytes = excluded.size_bytes,
    checksum = excluded.checksum, uploaded_by = excluded.uploaded_by,
    uploaded_at = now()
  returning * into next_row;
  insert into public.service_plan_document_audit (
    plan_id, document_kind, action, previous_storage_key, storage_key, file_name, mime_type, size_bytes, checksum, actor_id
  ) values (
    p_plan_id, p_document_kind, case when old_row.id is null then 'attached' else 'replaced' end, old_row.storage_key,
    next_row.storage_key, next_row.file_name, next_row.mime_type, next_row.size_bytes, next_row.checksum, p_actor_id
  );
  return jsonb_build_object('document', to_jsonb(next_row), 'oldStorageKey', old_row.storage_key);
end
$function$;
revoke execute on function public.upsert_service_plan_document(uuid, uuid, text, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.upsert_service_plan_document(uuid, uuid, text, text, text, text, bigint, text) to service_role;

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
    insert into public.service_plan_test_items(plan_id, line_number, name, unit)
    values (plan_row.id, line_no, btrim(line ->> 'name'), btrim(line ->> 'unit'));
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
    insert into public.service_plan_test_items(plan_id, line_number, name, unit)
    values (p_plan_id, line_no, btrim(line ->> 'name'), btrim(line ->> 'unit'));
  end loop;
  select coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload -> 'responsibleProfileIds', '[]'::jsonb)) value), '{}'::uuid[]) into desired_ids;
  perform public.set_service_plan_responsibles(p_actor_id, p_plan_id, desired_ids);
  return updated_plan;
end
$function$;
revoke execute on function public.update_service_procurement_plan(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_service_procurement_plan(uuid, uuid, jsonb) to service_role;

-- A closing/closed plan is read-only; only its already-created POs may finish.
create or replace function public.set_service_plan_responsibles(
  p_actor_id uuid, p_plan_id uuid, p_profile_ids uuid[]
)
returns public.service_procurement_plans language plpgsql security invoker set search_path = '' as $function$
declare current_id uuid; desired_id uuid; updated_plan public.service_procurement_plans%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  perform 1 from public.service_procurement_plans plan where plan.id = p_plan_id and plan.status = 'active' for update;
  if not found then
    raise exception using errcode = '55000', message = 'only active service plans can change responsibles';
  end if;
  foreach desired_id in array coalesce(p_profile_ids, '{}'::uuid[]) loop
    if not exists (select 1 from public.profiles profile where profile.id = desired_id and profile.status = 'active' and profile.deleted_at is null) then
      raise exception using errcode = '23503', message = 'responsible profile is not active';
    end if;
  end loop;
  for current_id in select responsible.profile_id from public.service_plan_responsibles responsible where responsible.plan_id = p_plan_id loop
    if not (current_id = any(coalesce(p_profile_ids, '{}'::uuid[]))) then
      delete from public.service_plan_responsibles where plan_id = p_plan_id and profile_id = current_id;
      insert into public.service_plan_responsible_audit(plan_id, profile_id, action, actor_id) values (p_plan_id, current_id, 'removed', p_actor_id);
    end if;
  end loop;
  foreach desired_id in array coalesce(p_profile_ids, '{}'::uuid[]) loop
    if not exists (select 1 from public.service_plan_responsibles responsible where responsible.plan_id = p_plan_id and responsible.profile_id = desired_id) then
      insert into public.service_plan_responsibles(plan_id, profile_id, assigned_by) values (p_plan_id, desired_id, p_actor_id);
      insert into public.service_plan_responsible_audit(plan_id, profile_id, action, actor_id) values (p_plan_id, desired_id, 'added', p_actor_id);
    end if;
  end loop;
  select * into updated_plan from public.service_procurement_plans plan where plan.id = p_plan_id;
  return updated_plan;
end
$function$;
revoke execute on function public.set_service_plan_responsibles(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_service_plan_responsibles(uuid, uuid, uuid[]) to service_role;

create or replace function public.revise_service_plan_budget(
  p_actor_id uuid, p_plan_id uuid, p_next_budget numeric, p_reason text
)
returns public.service_procurement_plans language plpgsql security invoker set search_path = '' as $function$
declare current_plan public.service_procurement_plans%rowtype; plan_balance record; updated_plan public.service_procurement_plans%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  if nullif(btrim(coalesce(p_reason, '')), '') is null or p_next_budget <= 0 then
    raise exception using errcode = '23514', message = 'budget revision requires a positive amount and reason';
  end if;
  select * into current_plan from public.service_procurement_plans plan where plan.id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  if current_plan.status <> 'active' then raise exception using errcode = '55000', message = 'only active service plans can change budget'; end if;
  select * into plan_balance from public.service_procurement_plan_balance(p_plan_id);
  if p_next_budget < plan_balance.spent + plan_balance.reserved then
    raise exception using errcode = '23514', message = 'new budget is below spent and reserved amount';
  end if;
  update public.service_procurement_plans set budget = p_next_budget, updated_by = p_actor_id where id = p_plan_id returning * into updated_plan;
  insert into public.service_plan_budget_revisions(plan_id, previous_budget, next_budget, reason, actor_id)
  values (p_plan_id, current_plan.budget, p_next_budget, btrim(p_reason), p_actor_id);
  return updated_plan;
end
$function$;
revoke execute on function public.revise_service_plan_budget(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.revise_service_plan_budget(uuid, uuid, numeric, text) to service_role;

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
      purchase_request_id, plan_item_id, line_number, name, unit, requested_quantity
    ) values (
      request_row.id, item_row.id, line_no, item_row.name, item_row.unit,
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

create or replace function public.confirm_service_purchase_request(p_actor_id uuid, p_request_id uuid)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare request_row public.service_purchase_requests%rowtype; plan_row public.service_procurement_plans%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if request_row.status <> 'pending' then raise exception using errcode = '55000', message = 'only pending service requests can be confirmed'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if not found or plan_row.status <> 'active' then raise exception using errcode = '55000', message = 'service plan is not open for PR confirmation'; end if;
  update public.service_purchase_requests set status = 'confirmed', confirmed_by = p_actor_id, confirmed_at = now(), updated_by = p_actor_id where id = p_request_id returning * into request_row;
  return request_row;
end
$function$;
revoke execute on function public.confirm_service_purchase_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_service_purchase_request(uuid, uuid) to service_role;

create or replace function public.close_service_purchase_request_po(p_actor_id uuid, p_request_id uuid, p_reason text default null)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  expense_total numeric(17,2);
  remaining_reservation numeric(17,2);
  plan_row public.service_procurement_plans%rowtype;
begin
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if not (public.service_procurement_actor_has_role(p_actor_id, 'admin') or request_row.requester_id = p_actor_id
    or exists (
      select 1
      from public.service_plan_responsibles responsible
      join public.profiles responsible_profile on responsible_profile.id = responsible.profile_id
      where responsible.plan_id = request_row.plan_id and responsible.profile_id = p_actor_id
        and responsible_profile.status = 'active' and responsible_profile.deleted_at is null
    )) then
    raise exception using errcode = '42501', message = 'only the PR requester or plan expense recorder may close this service PO';
  end if;
  if request_row.status = 'closed' and request_row.po_status = 'closed' then return request_row; end if;
  if request_row.status <> 'confirmed' or request_row.po_status in ('closed', 'cancelled')
    or request_row.po_number is null or request_row.po_file_path is null then raise exception using errcode = '55000', message = 'service PO requires both number and file before closing'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if not found or plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot close a new PO'; end if;
  perform 1 from public.service_purchase_request_expenses expense where expense.purchase_request_id = p_request_id for update;
  select coalesce(sum(expense.amount), 0) into expense_total from public.service_purchase_request_expenses expense where expense.purchase_request_id = p_request_id and expense.status = 'active';
  if expense_total > request_row.requested_amount then raise exception using errcode = '23514', message = 'service expenses exceed PR ceiling'; end if;
  if expense_total > 0 then
    insert into public.service_plan_ledger(plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id)
    values (plan_row.id, 'expense', expense_total, (timezone('Asia/Bangkok', now()))::date, p_request_id, 'ค่าใช้จ่ายจริงเมื่อปิด PO งานจ้าง', request_row.document_number, p_actor_id);
  end if;
  select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
    into remaining_reservation from public.service_plan_ledger ledger where ledger.purchase_request_id = p_request_id;
  if remaining_reservation > 0 then
    insert into public.service_plan_ledger(plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id)
    values (plan_row.id, 'reservation_release', -remaining_reservation, (timezone('Asia/Bangkok', now()))::date, p_request_id, coalesce(nullif(btrim(p_reason), ''), 'คืนยอดสำรองเมื่อปิด PO'), request_row.document_number, p_actor_id);
  end if;
  update public.service_purchase_requests set status = 'closed', po_status = 'closed', closed_by = p_actor_id, closed_at = now(), updated_by = p_actor_id where id = p_request_id returning * into request_row;
  insert into public.service_purchase_request_po_events(purchase_request_id, event_kind, po_number, po_file_path, reason, actor_id)
  values (p_request_id, 'closed', request_row.po_number, request_row.po_file_path, nullif(btrim(coalesce(p_reason, '')), ''), p_actor_id);
  return request_row;
end
$function$;
revoke execute on function public.close_service_purchase_request_po(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.close_service_purchase_request_po(uuid, uuid, text) to service_role;

create or replace function public.cancel_service_purchase_request_po(p_actor_id uuid, p_request_id uuid, p_reason text)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare request_row public.service_purchase_requests%rowtype; plan_row public.service_procurement_plans%rowtype; remaining_reservation numeric(17,2);
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception using errcode = '23514', message = 'PO cancellation requires a reason'; end if;
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if not (public.service_procurement_actor_has_role(p_actor_id, 'admin') or request_row.requester_id = p_actor_id) then raise exception using errcode = '42501', message = 'only the PR requester or admin may cancel this service PO'; end if;
  if request_row.plan_id is null then raise exception using errcode = '55000', message = 'service PO must reference a plan'; end if;
  if request_row.status = 'closed' or request_row.po_status = 'closed' then raise exception using errcode = '55000', message = 'closed service PO cannot be cancelled'; end if;
  if request_row.status <> 'confirmed' or request_row.po_status = 'cancelled' or request_row.po_number is null or request_row.po_file_path is null then raise exception using errcode = '55000', message = 'service PO requires both number and file before cancellation'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if not found or plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot cancel a PO'; end if;
  select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0) into remaining_reservation from public.service_plan_ledger ledger where ledger.purchase_request_id = p_request_id;
  if remaining_reservation > 0 then
    insert into public.service_plan_ledger(plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id)
    values (request_row.plan_id, 'reservation_release', -remaining_reservation, (timezone('Asia/Bangkok', now()))::date, p_request_id, btrim(p_reason), request_row.document_number, p_actor_id);
  end if;
  update public.service_purchase_requests set status = 'cancelled', po_status = 'cancelled', cancelled_by = p_actor_id, cancelled_at = now(), cancellation_reason = btrim(p_reason), updated_by = p_actor_id where id = p_request_id returning * into request_row;
  insert into public.service_purchase_request_po_events(purchase_request_id, event_kind, po_number, po_file_path, reason, actor_id) values (p_request_id, 'cancelled', request_row.po_number, request_row.po_file_path, btrim(p_reason), p_actor_id);
  return request_row;
end
$function$;
revoke execute on function public.cancel_service_purchase_request_po(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_service_purchase_request_po(uuid, uuid, text) to service_role;

-- PO evidence may be maintained while the PO is open, but terminal records
-- cannot be edited through the stock-facing RPCs.
create or replace function public.set_service_purchase_request_ephis_number(p_actor_id uuid, p_request_id uuid, p_ephis_pr_number text)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare request_row public.service_purchase_requests%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if nullif(btrim(coalesce(p_ephis_pr_number, '')), '') is null then raise exception using errcode = '23514', message = 'E-Phis PR number is required'; end if;
  update public.service_purchase_requests set ephis_pr_number = btrim(p_ephis_pr_number), updated_by = p_actor_id where id = p_request_id and status = 'confirmed' and po_status not in ('closed', 'cancelled') and exists (select 1 from public.service_procurement_plans plan where plan.id = service_purchase_requests.plan_id and plan.status in ('active', 'closing')) returning * into request_row;
  if not found then raise exception using errcode = '55000', message = 'service request is not open for E-Phis number'; end if;
  return request_row;
end
$function$;
revoke execute on function public.set_service_purchase_request_ephis_number(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_service_purchase_request_ephis_number(uuid, uuid, text) to service_role;

create or replace function public.set_service_purchase_request_po_number(p_actor_id uuid, p_request_id uuid, p_po_number text)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare request_row public.service_purchase_requests%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if nullif(btrim(coalesce(p_po_number, '')), '') is null then raise exception using errcode = '23514', message = 'PO number is required'; end if;
  update public.service_purchase_requests set po_number = btrim(p_po_number), po_status = 'open', updated_by = p_actor_id where id = p_request_id and status = 'confirmed' and po_status not in ('closed', 'cancelled') and exists (select 1 from public.service_procurement_plans plan where plan.id = service_purchase_requests.plan_id and plan.status in ('active', 'closing')) returning * into request_row;
  if not found then raise exception using errcode = '55000', message = 'service request cannot record PO number'; end if;
  insert into public.service_purchase_request_po_events(purchase_request_id, event_kind, po_number, actor_id) values (request_row.id, 'number_added', request_row.po_number, p_actor_id);
  return request_row;
end
$function$;
revoke execute on function public.set_service_purchase_request_po_number(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_service_purchase_request_po_number(uuid, uuid, text) to service_role;

create or replace function public.set_service_purchase_request_po_file(p_actor_id uuid, p_request_id uuid, p_path text, p_file_name text, p_mime_type text, p_size_bytes bigint, p_checksum text)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare request_row public.service_purchase_requests%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if p_path is null or p_path not like ('service-procurement/po/' || p_request_id::text || '/%') or p_path like '%..%' or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') or p_size_bytes < 1 or p_size_bytes > 10485760 then raise exception using errcode = '22023', message = 'invalid service PO file'; end if;
  update public.service_purchase_requests set po_file_path = p_path, po_file_name = btrim(p_file_name), po_file_mime_type = p_mime_type, po_file_size_bytes = p_size_bytes, po_file_checksum = p_checksum, po_status = 'open', updated_by = p_actor_id where id = p_request_id and status = 'confirmed' and po_status not in ('closed', 'cancelled') and exists (select 1 from public.service_procurement_plans plan where plan.id = service_purchase_requests.plan_id and plan.status in ('active', 'closing')) returning * into request_row;
  if not found then raise exception using errcode = '55000', message = 'service request cannot attach PO file'; end if;
  insert into public.service_purchase_request_po_events(purchase_request_id, event_kind, po_number, po_file_path, actor_id) values (request_row.id, 'file_added', request_row.po_number, request_row.po_file_path, p_actor_id);
  return request_row;
end
$function$;
revoke execute on function public.set_service_purchase_request_po_file(uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.set_service_purchase_request_po_file(uuid, uuid, text, text, text, bigint, text) to service_role;

-- Header edits remain available only while a plan-backed PR is pending, and
-- cannot move the request outside the referenced plan's fiscal year.
create or replace function public.update_service_purchase_request_header(
  p_actor_id uuid, p_request_id uuid, p_department text, p_requested_date date, p_note text
)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare request_row public.service_purchase_requests%rowtype; plan_row public.service_procurement_plans%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'requester');
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if request_row.status <> 'pending' then raise exception using errcode = '55000', message = 'only pending service requests can be edited'; end if;
  if request_row.requester_id <> p_actor_id
    and not public.service_procurement_actor_has_role(p_actor_id, 'admin')
    and not public.service_procurement_actor_has_role(p_actor_id, 'head') then
    raise exception using errcode = '42501', message = 'actor cannot edit this service purchase request';
  end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if not found or plan_row.status <> 'active' then raise exception using errcode = '55000', message = 'service plan is not open for PR edits'; end if;
  if public.service_procurement_fiscal_year(p_requested_date) <> plan_row.fiscal_year then
    raise exception using errcode = '22023', message = 'request date must belong to the selected plan fiscal year';
  end if;
  update public.service_purchase_requests set
    department = btrim(p_department), requested_date = p_requested_date,
    note = nullif(btrim(coalesce(p_note, '')), ''), updated_by = p_actor_id
  where id = p_request_id returning * into request_row;
  return request_row;
end
$function$;
revoke execute on function public.update_service_purchase_request_header(uuid, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.update_service_purchase_request_header(uuid, uuid, text, date, text) to service_role;

-- Legacy annual-item/lab-expense entry points are deliberately disabled. The
-- new expense table is the only pre-close recording path.
create or replace function public.record_service_purchase_request_usage(p_actor_id uuid, p_request_id uuid, p_usage_date date, p_items jsonb, p_note text default null)
returns public.service_purchase_request_usage_events language plpgsql security invoker set search_path = '' as $function$
begin raise exception using errcode = '55000', message = 'annual item usage is not available in service procurement'; end
$function$;
create or replace function public.record_service_purchase_request_lab_expense(p_actor_id uuid, p_request_id uuid, p_expense_date date, p_amount numeric, p_note text default null)
returns public.service_purchase_request_usage_events language plpgsql security invoker set search_path = '' as $function$
begin raise exception using errcode = '55000', message = 'use record_service_purchase_request_expense'; end
$function$;
create or replace function public.adjust_service_purchase_request_lab_expense(p_actor_id uuid, p_request_id uuid, p_source_event_id uuid, p_expense_date date, p_amount numeric, p_note text)
returns public.service_purchase_request_usage_events language plpgsql security invoker set search_path = '' as $function$
begin raise exception using errcode = '55000', message = 'service expense adjustments use update/cancel expense RPCs'; end
$function$;

create or replace function public.record_service_plan_historical_expense(p_actor_id uuid, p_plan_id uuid, p_amount numeric, p_expense_date date, p_reason text, p_source_reference text)
returns public.service_plan_ledger language plpgsql security invoker set search_path = '' as $function$
begin raise exception using errcode = '55000', message = 'plan expenses are posted only when a service PO is closed'; end
$function$;
create or replace function public.adjust_service_plan_expense(p_actor_id uuid, p_plan_id uuid, p_amount numeric, p_expense_date date, p_reason text, p_source_reference text, p_source_ledger_id uuid default null)
returns public.service_plan_ledger language plpgsql security invoker set search_path = '' as $function$
begin raise exception using errcode = '55000', message = 'plan expenses are posted only when a service PO is closed'; end
$function$;

create or replace function public.record_service_purchase_request_expense(
  p_actor_id uuid, p_request_id uuid, p_expense_date date, p_amount numeric,
  p_invoice_number text default null, p_note text default null
)
returns public.service_purchase_request_expenses language plpgsql security invoker set search_path = '' as $function$
declare request_row public.service_purchase_requests%rowtype; plan_row public.service_procurement_plans%rowtype; expense_row public.service_purchase_request_expenses%rowtype; active_total numeric(17,2); frequency_value text;
begin
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.plan_id is null then raise exception using errcode = '55000', message = 'service expense must reference a plan'; end if;
  if p_amount is null or p_amount <= 0 then raise exception using errcode = '22023', message = 'expense amount must be positive'; end if;
  if request_row.status <> 'confirmed' or request_row.po_status in ('closed', 'cancelled') or (request_row.po_number is null and request_row.po_file_path is null) then raise exception using errcode = '55000', message = 'service PR must be confirmed and have PO evidence before recording expense'; end if;
  if p_expense_date < request_row.usage_start_date or p_expense_date > request_row.usage_end_date then raise exception using errcode = '22023', message = 'expense date must be inside PO usage range'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot record expense'; end if;
  frequency_value := case when plan_row.is_red_cross then 'daily' else 'monthly' end;
  select coalesce(sum(expense.amount), 0) into active_total from public.service_purchase_request_expenses expense where expense.purchase_request_id = p_request_id and expense.status = 'active';
  if active_total + p_amount > request_row.requested_amount then raise exception using errcode = '23514', message = 'active expenses exceed PR ceiling'; end if;
  insert into public.service_purchase_request_expenses(purchase_request_id, expense_date, amount, invoice_number, note, frequency, created_by, updated_by)
  values (p_request_id, p_expense_date, p_amount, nullif(btrim(coalesce(p_invoice_number, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), frequency_value, p_actor_id, p_actor_id)
  returning * into expense_row;
  insert into public.service_purchase_request_expense_audits(expense_id, purchase_request_id, action, before_data, after_data, actor_id)
  values (expense_row.id, p_request_id, 'created', null, to_jsonb(expense_row), p_actor_id);
  return expense_row;
end
$function$;
revoke execute on function public.record_service_purchase_request_expense(uuid, uuid, date, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_service_purchase_request_expense(uuid, uuid, date, numeric, text, text) to service_role;

create or replace function public.update_service_purchase_request_expense(
  p_actor_id uuid, p_expense_id uuid, p_expense_date date, p_amount numeric,
  p_invoice_number text default null, p_note text default null, p_reason text default null
)
returns public.service_purchase_request_expenses language plpgsql security invoker set search_path = '' as $function$
declare expense_row public.service_purchase_request_expenses%rowtype; before_data jsonb; request_row public.service_purchase_requests%rowtype; plan_row public.service_procurement_plans%rowtype; active_total numeric(17,2); request_id uuid;
begin
  select expense.purchase_request_id into request_id from public.service_purchase_request_expenses expense where expense.id = p_expense_id;
  if request_id is null then raise exception using errcode = '23503', message = 'service expense not found'; end if;
  select * into request_row from public.service_purchase_requests where id = request_id for update;
  select expense.* into expense_row from public.service_purchase_request_expenses expense where expense.id = p_expense_id for update;
  if request_row.plan_id is null then raise exception using errcode = '55000', message = 'service expense must reference a plan'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot edit expense'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.status <> 'confirmed' or expense_row.status <> 'active' then raise exception using errcode = '55000', message = 'closed or cancelled service expense cannot be edited'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception using errcode = '23514', message = 'expense edit requires a reason'; end if;
  if p_expense_date < request_row.usage_start_date or p_expense_date > request_row.usage_end_date or p_amount <= 0 then raise exception using errcode = '22023', message = 'expense date or amount is invalid'; end if;
  select coalesce(sum(expense.amount), 0) into active_total from public.service_purchase_request_expenses expense where expense.purchase_request_id = request_row.id and expense.status = 'active' and expense.id <> p_expense_id;
  if active_total + p_amount > request_row.requested_amount then raise exception using errcode = '23514', message = 'active expenses exceed PR ceiling'; end if;
  before_data := to_jsonb(expense_row);
  update public.service_purchase_request_expenses set expense_date = p_expense_date, amount = p_amount, invoice_number = nullif(btrim(coalesce(p_invoice_number, '')), ''), note = nullif(btrim(coalesce(p_note, '')), ''), updated_by = p_actor_id where id = p_expense_id returning * into expense_row;
  insert into public.service_purchase_request_expense_audits(expense_id, purchase_request_id, action, before_data, after_data, reason, actor_id)
  values (expense_row.id, request_row.id, 'updated', before_data, to_jsonb(expense_row), btrim(p_reason), p_actor_id);
  return expense_row;
end
$function$;
revoke execute on function public.update_service_purchase_request_expense(uuid, uuid, date, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.update_service_purchase_request_expense(uuid, uuid, date, numeric, text, text, text) to service_role;

create or replace function public.cancel_service_purchase_request_expense(p_actor_id uuid, p_expense_id uuid, p_reason text)
returns public.service_purchase_request_expenses language plpgsql security invoker set search_path = '' as $function$
declare expense_row public.service_purchase_request_expenses%rowtype; before_data jsonb; request_row public.service_purchase_requests%rowtype; plan_row public.service_procurement_plans%rowtype; request_id uuid;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception using errcode = '23514', message = 'expense cancellation requires a reason'; end if;
  select expense.purchase_request_id into request_id from public.service_purchase_request_expenses expense where expense.id = p_expense_id;
  if request_id is null then raise exception using errcode = '23503', message = 'service expense not found'; end if;
  select * into request_row from public.service_purchase_requests where id = request_id for update;
  select expense.* into expense_row from public.service_purchase_request_expenses expense where expense.id = p_expense_id for update;
  if request_row.plan_id is null then raise exception using errcode = '55000', message = 'service expense must reference a plan'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot cancel expense'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.status <> 'confirmed' or expense_row.status <> 'active' then raise exception using errcode = '55000', message = 'closed or cancelled service expense cannot be cancelled'; end if;
  before_data := to_jsonb(expense_row);
  update public.service_purchase_request_expenses set status = 'cancelled', cancelled_by = p_actor_id, cancelled_at = now(), updated_by = p_actor_id where id = p_expense_id returning * into expense_row;
  insert into public.service_purchase_request_expense_audits(expense_id, purchase_request_id, action, before_data, after_data, reason, actor_id)
  values (expense_row.id, request_row.id, 'cancelled', before_data, to_jsonb(expense_row), btrim(p_reason), p_actor_id);
  return expense_row;
end
$function$;
revoke execute on function public.cancel_service_purchase_request_expense(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_service_purchase_request_expense(uuid, uuid, text) to service_role;

create or replace function public.advance_service_procurement_plan_lifecycle(p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare plan_record public.service_procurement_plans%rowtype; document_record public.service_plan_documents%rowtype; keys jsonb; result jsonb := '[]'::jsonb; current_fiscal_year integer;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  current_fiscal_year := public.service_procurement_fiscal_year((timezone('Asia/Bangkok', now()))::date);
  for plan_record in select plan_source.* from public.service_procurement_plans plan_source where plan_source.status <> 'closed' and plan_source.fiscal_year < current_fiscal_year for update loop
    if plan_record.status = 'active' then update public.service_procurement_plans set status = 'closing', updated_by = p_actor_id where id = plan_record.id; end if;
    if not exists (select 1 from public.service_purchase_requests request where request.plan_id = plan_record.id and request.status in ('pending', 'confirmed') and request.po_status not in ('closed', 'cancelled')) then
      select coalesce(jsonb_agg(document.storage_key), '[]'::jsonb) into keys from public.service_plan_documents document where document.plan_id = plan_record.id;
      for document_record in select document_source.* from public.service_plan_documents document_source where document_source.plan_id = plan_record.id for update loop
        insert into public.service_plan_document_audit(plan_id, document_kind, action, storage_key, file_name, mime_type, size_bytes, checksum, actor_id, reason)
        values (document_record.plan_id, document_record.document_kind, 'deleted', document_record.storage_key, document_record.file_name, document_record.mime_type, document_record.size_bytes, document_record.checksum, p_actor_id, 'ปิดแผนสิ้นปีงบประมาณ');
      end loop;
      delete from public.service_plan_documents where plan_id = plan_record.id;
      update public.service_procurement_plans set status = 'closed', closed_at = now(), updated_by = p_actor_id where id = plan_record.id;
      result := result || jsonb_build_array(jsonb_build_object('planId', plan_record.id, 'storageKeys', keys));
    end if;
  end loop;
  return result;
end
$function$;
revoke execute on function public.advance_service_procurement_plan_lifecycle(uuid) from public, anon, authenticated;
grant execute on function public.advance_service_procurement_plan_lifecycle(uuid) to service_role;

-- Replace only the service cancellation copy in the existing trigger. Purchase
-- notifications keep their existing event and visual treatment.
create or replace function public.enqueue_service_purchase_request_notification()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare plan_name text; actor_name text;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    insert into public.lab_stock_notifications(recipient_id, event_type, entity_type, entity_id, document_number, title, body, href)
    select distinct profile.id, 'service_purchase_request_created', 'service_purchase_request', new.id, new.document_number,
      'มีใบ PR งานจ้างใหม่รอดำเนินการ', format('หน่วยงาน %s · ผู้ขอ %s', new.department, new.requester_name), '/service-procurement/purchase-requests/' || new.id::text
    from public.profiles profile left join public.lab_stock_memberships membership on membership.profile_id = profile.id and membership.active
    where profile.status = 'active' and profile.deleted_at is null and (profile.ephis_id = '9495' or membership.role in ('admin', 'stock_officer'))
    on conflict (recipient_id, event_type, entity_id) do nothing;
  elsif new.po_status = 'cancelled' and tg_op = 'UPDATE' and old.po_status <> 'cancelled'
    and (new.po_number is not null or new.po_file_path is not null) then
    select plan.name, profile.name into plan_name, actor_name
    from public.service_procurement_plans plan
    left join public.profiles profile on profile.id = new.cancelled_by
    where plan.id = new.plan_id;
    insert into public.lab_stock_notifications(recipient_id, event_type, entity_type, entity_id, document_number, title, body, href)
    select distinct profile.id, 'service_purchase_order_cancelled', 'service_purchase_request', new.id, new.document_number,
      'งานจ้าง · ยกเลิก PO', format('PR %s · PO %s · แผน %s · ผู้ยกเลิก %s · เหตุผล: %s', new.document_number, coalesce(new.po_number, 'ไม่ระบุ'), coalesce(plan_name, 'ไม่ระบุ'), coalesce(actor_name, new.cancelled_by::text, 'ไม่ระบุ'), coalesce(new.cancellation_reason, 'ไม่ระบุ')), '/service-procurement/purchase-requests/' || new.id::text
    from public.profiles profile left join public.lab_stock_memberships membership on membership.profile_id = profile.id and membership.active
    where profile.status = 'active' and profile.deleted_at is null and (profile.ephis_id = '9495' or membership.role in ('admin', 'stock_officer'))
    on conflict (recipient_id, event_type, entity_id) do nothing;
  end if;
  return new;
end
$function$;
revoke execute on function public.enqueue_service_purchase_request_notification() from public, anon, authenticated;

commit;
