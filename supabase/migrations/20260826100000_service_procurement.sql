-- งานจ้าง: independent service-procurement domain.
-- All writes are made through service-role-only RPCs. Financial rows are
-- append-only; corrections and cancellations are compensating entries.
begin;

do $guard$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.lab_stock_memberships') is null
    or to_regclass('public.inventory_items') is null then
    raise exception using
      errcode = '42P01',
      message = 'service procurement requires profiles, lab_stock_memberships and inventory_items';
  end if;
end
$guard$;

create table if not exists public.service_procurement_plans (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  name text not null check (nullif(btrim(name), '') is not null),
  department text not null check (nullif(btrim(department), '') is not null),
  plan_type text not null check (plan_type in (
    'laboratory_testing',
    'medical_services',
    'personnel',
    'medical_equipment_maintenance',
    'other_services'
  )),
  budget numeric(17,2) not null check (budget > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_procurement_plans_register_idx
  on public.service_procurement_plans (fiscal_year desc, department, plan_type);
create index if not exists service_procurement_plans_name_idx
  on public.service_procurement_plans using gin (to_tsvector('simple', name));

create table if not exists public.service_plan_responsibles (
  plan_id uuid not null references public.service_procurement_plans(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (plan_id, profile_id)
);
create index if not exists service_plan_responsibles_profile_idx
  on public.service_plan_responsibles (profile_id, plan_id);

create table if not exists public.service_plan_responsible_audit (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.service_procurement_plans(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('added', 'removed')),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists service_plan_responsible_audit_plan_idx
  on public.service_plan_responsible_audit (plan_id, created_at desc);

create table if not exists public.service_plan_budget_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.service_procurement_plans(id) on delete cascade,
  previous_budget numeric(17,2) not null check (previous_budget > 0),
  next_budget numeric(17,2) not null check (next_budget > 0),
  reason text not null check (nullif(btrim(reason), '') is not null),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists service_plan_budget_revisions_plan_idx
  on public.service_plan_budget_revisions (plan_id, created_at desc);

create table if not exists public.service_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  sequence_number integer not null check (sequence_number > 0),
  document_number text not null check (nullif(btrim(document_number), '') is not null),
  requester_id uuid references public.profiles(id) on delete set null,
  requester_name text not null check (nullif(btrim(requester_name), '') is not null),
  department text not null check (nullif(btrim(department), '') is not null),
  requested_date date not null,
  note text,
  plan_id uuid references public.service_procurement_plans(id) on delete restrict,
  purchase_method text not null check (purchase_method in ('annual_items', 'laboratory_testing')),
  requested_amount numeric(17,2) not null check (requested_amount > 0),
  requested_po_month date check (requested_po_month is null or extract(day from requested_po_month) = 1),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'closed', 'cancelled')),
  po_status text not null default 'not_issued' check (po_status in ('not_issued', 'open', 'closed', 'cancelled')),
  ephis_pr_number text,
  po_number text,
  po_file_path text,
  po_file_name text,
  po_file_mime_type text,
  po_file_size_bytes bigint check (po_file_size_bytes is null or po_file_size_bytes between 1 and 10485760),
  po_file_checksum text,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_year, sequence_number),
  check (po_file_path is null or (po_file_path like 'service-procurement/%' and po_file_path not like '%..%')),
  check ((po_file_path is null and po_file_name is null) or (po_file_path is not null and po_file_name is not null))
);
create unique index if not exists service_purchase_requests_document_number_ci_idx
  on public.service_purchase_requests (lower(btrim(document_number)));
create index if not exists service_purchase_requests_register_idx
  on public.service_purchase_requests (fiscal_year desc, requested_date desc, status);
create index if not exists service_purchase_requests_plan_idx
  on public.service_purchase_requests (plan_id, status) where plan_id is not null;
create index if not exists service_purchase_requests_open_idx
  on public.service_purchase_requests (plan_id, requested_amount)
  where plan_id is not null and status in ('pending', 'confirmed') and po_status not in ('closed', 'cancelled');

create table if not exists public.service_purchase_request_po_events (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  event_kind text not null check (event_kind in ('number_added', 'file_added', 'closed', 'cancelled')),
  po_number text,
  po_file_path text,
  reason text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists service_purchase_request_po_events_request_idx
  on public.service_purchase_request_po_events (purchase_request_id, created_at desc);

create table if not exists public.service_purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  ls_code text not null check (nullif(btrim(ls_code), '') is not null),
  name text not null check (nullif(btrim(name), '') is not null),
  unit text not null check (nullif(btrim(unit), '') is not null),
  requested_quantity numeric(15,3) not null check (requested_quantity > 0),
  unit_price numeric(15,2) not null check (unit_price >= 0),
  line_total numeric(17,2) generated always as (round(requested_quantity * unit_price, 2)) stored,
  used_quantity numeric(15,3) not null default 0 check (used_quantity >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_request_id, line_number),
  unique (purchase_request_id, inventory_item_id)
);
create index if not exists service_purchase_request_items_request_idx
  on public.service_purchase_request_items (purchase_request_id, line_number);

create table if not exists public.service_purchase_request_usage_events (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  event_kind text not null check (event_kind in ('annual_usage', 'lab_expense', 'expense_adjustment', 'expense_reversal')),
  expense_date date not null,
  amount numeric(17,2) not null check (amount <> 0),
  note text,
  reference_event_id uuid references public.service_purchase_request_usage_events(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (reference_event_id),
  check ((event_kind in ('annual_usage', 'lab_expense') and amount > 0) or event_kind in ('expense_adjustment', 'expense_reversal'))
);
create index if not exists service_purchase_request_usage_events_request_idx
  on public.service_purchase_request_usage_events (purchase_request_id, expense_date desc);
create unique index if not exists service_lab_primary_expense_key
  on public.service_purchase_request_usage_events (purchase_request_id)
  where event_kind = 'lab_expense';

create table if not exists public.service_purchase_request_usage_items (
  id uuid primary key default gen_random_uuid(),
  usage_event_id uuid not null references public.service_purchase_request_usage_events(id) on delete restrict,
  purchase_request_item_id uuid not null references public.service_purchase_request_items(id) on delete restrict,
  quantity numeric(15,3) not null check (quantity > 0),
  amount numeric(17,2) not null check (amount > 0),
  unique (usage_event_id, purchase_request_item_id)
);
create index if not exists service_purchase_request_usage_items_item_idx
  on public.service_purchase_request_usage_items (purchase_request_item_id);

create table if not exists public.service_plan_ledger (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.service_procurement_plans(id) on delete restrict,
  entry_kind text not null check (entry_kind in (
    'reservation',
    'reservation_release',
    'expense',
    'historical_expense',
    'expense_adjustment',
    'expense_reversal'
  )),
  amount numeric(17,2) not null check (amount <> 0),
  event_date date not null,
  purchase_request_id uuid references public.service_purchase_requests(id) on delete restrict,
  usage_event_id uuid references public.service_purchase_request_usage_events(id) on delete restrict,
  reference_ledger_id uuid references public.service_plan_ledger(id) on delete restrict,
  reason text not null check (nullif(btrim(reason), '') is not null),
  source_reference text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (usage_event_id, entry_kind),
  check ((entry_kind in ('reservation', 'expense', 'historical_expense') and amount > 0) or entry_kind in ('reservation_release', 'expense_adjustment', 'expense_reversal'))
);
create index if not exists service_plan_ledger_plan_date_idx
  on public.service_plan_ledger (plan_id, event_date desc, created_at desc);
create index if not exists service_plan_ledger_request_idx
  on public.service_plan_ledger (purchase_request_id, created_at desc)
  where purchase_request_id is not null;
create index if not exists service_plan_ledger_open_reservation_idx
  on public.service_plan_ledger (plan_id, amount)
  where entry_kind in ('reservation', 'reservation_release');

create table if not exists public.service_purchase_request_attachments (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  attachment_kind text not null check (attachment_kind in ('tor', 'quotation')),
  slot smallint not null check (slot between 1 and 3),
  storage_key text not null unique check (storage_key like 'service-procurement/%' and storage_key not like '%..%'),
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  check (attachment_kind <> 'tor' or mime_type = 'application/pdf'),
  unique (purchase_request_id, attachment_kind, slot)
);
create index if not exists service_purchase_request_attachments_request_idx
  on public.service_purchase_request_attachments (purchase_request_id, attachment_kind, slot);

create table if not exists public.service_purchase_request_committees (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  committee_kind text not null check (committee_kind in ('specification', 'inspection')),
  seat smallint not null check (seat between 1 and 3),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  name_snapshot text not null,
  position_snapshot text,
  created_at timestamptz not null default now(),
  unique (purchase_request_id, committee_kind, seat),
  unique (purchase_request_id, committee_kind, profile_id)
);
create index if not exists service_purchase_request_committees_profile_idx
  on public.service_purchase_request_committees (profile_id);

-- Extend the existing bell queue without changing normal PR behavior.
do $notification_constraint$
begin
  alter table public.lab_stock_notifications
    drop constraint if exists lab_stock_notifications_event_type_check;
  alter table public.lab_stock_notifications
    add constraint lab_stock_notifications_event_type_check check (event_type in (
      'purchase_request_created',
      'requisition_created',
      'service_purchase_request_created',
      'service_purchase_order_cancelled'
    ));
  alter table public.lab_stock_notifications
    drop constraint if exists lab_stock_notifications_entity_type_check;
  alter table public.lab_stock_notifications
    add constraint lab_stock_notifications_entity_type_check check (entity_type in (
      'purchase_request',
      'requisition',
      'service_purchase_request'
    ));
end
$notification_constraint$;

create or replace function public.service_procurement_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;
revoke execute on function public.service_procurement_set_updated_at() from public, anon, authenticated;

drop trigger if exists service_procurement_plans_updated_at on public.service_procurement_plans;
create trigger service_procurement_plans_updated_at
before update on public.service_procurement_plans
for each row execute function public.service_procurement_set_updated_at();
drop trigger if exists service_purchase_requests_updated_at on public.service_purchase_requests;
create trigger service_purchase_requests_updated_at
before update on public.service_purchase_requests
for each row execute function public.service_procurement_set_updated_at();

create or replace function public.service_procurement_prevent_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = format('%s is append-only', tg_table_name);
end
$function$;
revoke execute on function public.service_procurement_prevent_ledger_mutation() from public, anon, authenticated;
drop trigger if exists service_plan_ledger_append_only on public.service_plan_ledger;
create trigger service_plan_ledger_append_only
before update or delete on public.service_plan_ledger
for each row execute function public.service_procurement_prevent_ledger_mutation();
drop trigger if exists service_usage_events_append_only on public.service_purchase_request_usage_events;
create trigger service_usage_events_append_only
before update or delete on public.service_purchase_request_usage_events
for each row execute function public.service_procurement_prevent_ledger_mutation();
drop trigger if exists service_po_events_append_only on public.service_purchase_request_po_events;
create trigger service_po_events_append_only
before update or delete on public.service_purchase_request_po_events
for each row execute function public.service_procurement_prevent_ledger_mutation();

commit;
