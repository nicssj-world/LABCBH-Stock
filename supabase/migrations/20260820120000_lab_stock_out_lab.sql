-- LABCBH Stock — "Out Lab": สัญญาจ้างตรวจทางห้องปฏิบัติการ (send-out testing).
--
-- This register was kept in a Google Sheet ("OUT LAB") with no ceiling control,
-- no permissions, and no record of who entered a figure. It is contract-shaped
-- and it draws down in baht per month, which is the same *mechanism* as an
-- equipment lease — but it is a different kind of contract and it deliberately
-- gets its own tables rather than a new value in contracts.contract_type:
--
--   * public.contracts and public.contract_usage carry the portal's two years
--     of real financial history. CLAUDE.md forbids touching contract_usage's
--     rows, and guard_contract_tracking_mode() hard-codes 'equipment_lease',
--     so a send-out contract could not write there anyway.
--   * Adding a contract_type would immediately surface these rows in the
--     /contracts register, the dashboard and the PR flow. The people who run
--     this register asked for it to stay separate.
--
-- Two shapes live in one table, told apart by `kind`:
--
--   contract_ceiling  a signed contract with its own value and start/end dates,
--                     spending capped by that value, walking the six
--                     procurement stages. e.g. ตรวจต่อพิเศษ N-Health.
--   annual_plan       a yearly planned budget with no procurement stages,
--                     re-registered every fiscal year, bounded by that fiscal
--                     year. e.g. ไทรอยด์ กรมวิทย์, HIV กรมวิทย์.
--
-- `entry_cadence` is a second, independent axis (monthly / quarterly /
-- as_needed) used only to warn about a period nobody filled in. It never
-- blocks a write.

begin;

create table if not exists public.out_lab_contracts (
  id uuid primary key default gen_random_uuid(),

  kind text not null check (kind in ('contract_ceiling', 'annual_plan')),
  entry_cadence text not null check (entry_cadence in ('monthly', 'quarterly', 'as_needed')),

  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  display_name text not null check (nullif(btrim(display_name), '') is not null),
  vendor text,
  department text,
  contract_number text,

  -- The ceiling for a contract_ceiling row, the planned budget for an
  -- annual_plan row. NULL means the ceiling is unknown, never zero — the two
  -- mean opposite things to whoever is deciding whether there is room to spend.
  total numeric(15,2) check (total is null or total > 0),

  -- NOT NULL for both kinds. create_out_lab_contract derives the fiscal-year
  -- boundaries for an annual_plan row, so every month-range guard downstream
  -- can use one code path instead of branching on kind.
  start_date date not null,
  end_date date not null,

  procurement_stage text check (procurement_stage in (
    'sent_to_procurement',
    'plan_published',
    'tender_announced',
    'result_consideration',
    'winner_announced',
    'contract_started'
  )),
  sent_to_procurement_date date,
  plan_published_date date,
  tender_announced_date date,
  result_consideration_date date,
  winner_announced_date date,
  contract_started_date date,
  stage_updated_at timestamptz,

  status text not null default 'pending'
    check (status in ('pending', 'active', 'expired', 'cancelled')),

  is_archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  archive_reason text,

  responsible_user_ids uuid[] not null default '{}'::uuid[],
  file_url text,
  note text,
  -- Lifecycle evidence (why a contract was ended, and by whom) lives here
  -- rather than being appended to `note`, which belongs to whoever typed it.
  source_metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,

  constraint out_lab_contracts_department_check check (department is null or department in (
    'สำนักงานกลุ่มงานเทคนิคการแพทย์',
    'งานเคมีคลินิก',
    'งานโลหิตวิทยาคลินิก',
    'งานภูมิคุ้มกันวิทยาคลินิก',
    'งานจุลทรรศนศาสตร์คลินิก',
    'งานอณูชีววิทยา',
    'งานจุลชีววิทยา',
    'งานคลังเลือด',
    'งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ',
    'งานบริการผู้ป่วยนอก',
    'ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี',
    'คลังน้ำยาและวัสดุวิทยาศาสตร์',
    'POCT'
  )),

  constraint out_lab_contracts_date_order_check check (start_date <= end_date),

  -- "An annual_plan row has no procurement stages" is enforced here rather
  -- than only in the RPC and the UI, because hiding a button is not the same
  -- as making the state unreachable.
  constraint out_lab_contracts_kind_shape_check check (
    (kind = 'contract_ceiling' and procurement_stage is not null)
    or (
      kind = 'annual_plan'
      and procurement_stage is null
      and num_nonnulls(
        sent_to_procurement_date,
        plan_published_date,
        tender_announced_date,
        result_consideration_date,
        winner_announced_date,
        contract_started_date
      ) = 0
    )
  ),

  constraint out_lab_contracts_stage_number_check check (
    procurement_stage is distinct from 'contract_started'
    or nullif(btrim(contract_number), '') is not null
  )
);

create index if not exists out_lab_contracts_register_idx
  on public.out_lab_contracts (is_archived, fiscal_year desc, kind);
create index if not exists out_lab_contracts_kind_cadence_idx
  on public.out_lab_contracts (kind, entry_cadence);
create index if not exists out_lab_contracts_status_idx
  on public.out_lab_contracts (status);
create index if not exists out_lab_contracts_created_by_idx
  on public.out_lab_contracts (created_by) where created_by is not null;

-- Scoped to this register only. A cross-table unique index against
-- public.contracts is not expressible, and the two registers are deliberately
-- separate, so a number may legitimately repeat across them.
create unique index if not exists out_lab_contracts_contract_number_normalized_key
  on public.out_lab_contracts (lower(btrim(contract_number)))
  where contract_number is not null and nullif(btrim(contract_number), '') is not null;

-- One amount per contract per month. The source spreadsheet works that way and
-- the people using it think that way: correcting a month replaces its figure
-- rather than appending a second row that has to be mentally netted off.
create table if not exists public.out_lab_monthly_usage (
  id uuid primary key default gen_random_uuid(),
  out_lab_contract_id uuid not null references public.out_lab_contracts(id) on delete restrict,
  usage_month date not null,
  amount numeric(15,2) not null check (amount > 0),
  note text,
  -- Display name copied at write time, matching contract_usage.recorded_by, so
  -- attribution survives a profile being renamed or deactivated.
  recorded_by text,
  recorded_by_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,

  -- contract_usage only enforces the first-of-month rule inside its RPC. This
  -- is a new table, so the rule can live where nothing can route around it.
  -- The explicit ::timestamp cast picks date_trunc(text, timestamp), which is
  -- IMMUTABLE. Left to infer, a date argument resolves to the timestamptz
  -- overload -- STABLE, and rejected outright inside a CHECK constraint.
  constraint out_lab_monthly_usage_month_start_check
    check (usage_month = date_trunc('month', usage_month::timestamp)::date),

  unique (out_lab_contract_id, usage_month)
);

create index if not exists out_lab_monthly_usage_contract_month_idx
  on public.out_lab_monthly_usage (out_lab_contract_id, usage_month desc);
create index if not exists out_lab_monthly_usage_recorded_by_id_idx
  on public.out_lab_monthly_usage (recorded_by_id) where recorded_by_id is not null;

-- Only a contract_ceiling row ever gets entries here; an annual_plan row has
-- no stages to record.
create table if not exists public.out_lab_contract_stage_history (
  id uuid primary key default gen_random_uuid(),
  out_lab_contract_id uuid not null references public.out_lab_contracts(id) on delete restrict,
  from_stage text check (from_stage is null or from_stage in (
    'sent_to_procurement',
    'plan_published',
    'tender_announced',
    'result_consideration',
    'winner_announced',
    'contract_started'
  )),
  to_stage text not null check (to_stage in (
    'sent_to_procurement',
    'plan_published',
    'tender_announced',
    'result_consideration',
    'winner_announced',
    'contract_started'
  )),
  effective_date date not null,
  contract_number_snapshot text,
  note text,
  source text not null default 'labcbh_stock'
    check (source in ('labcbh_stock', 'legacy_import', 'portal_migration')),
  actor_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (out_lab_contract_id, to_stage)
);

create index if not exists out_lab_contract_stage_history_contract_idx
  on public.out_lab_contract_stage_history (out_lab_contract_id, created_at desc);

-- Being listed on a contract is the right to spend against it, so changes are
-- recorded the same way they are for public.contracts.
create table if not exists public.out_lab_responsible_audit (
  id uuid primary key default gen_random_uuid(),
  out_lab_contract_id uuid not null references public.out_lab_contracts(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  previous_assigned boolean,
  next_assigned boolean not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists out_lab_responsible_audit_contract_idx
  on public.out_lab_responsible_audit (out_lab_contract_id, created_at desc);
create index if not exists out_lab_responsible_audit_profile_idx
  on public.out_lab_responsible_audit (profile_id, created_at desc);

drop trigger if exists out_lab_contracts_set_updated_at on public.out_lab_contracts;
create trigger out_lab_contracts_set_updated_at
before update on public.out_lab_contracts
for each row execute function public.lab_stock_set_updated_at();

drop trigger if exists out_lab_monthly_usage_set_updated_at on public.out_lab_monthly_usage;
create trigger out_lab_monthly_usage_set_updated_at
before update on public.out_lab_monthly_usage
for each row execute function public.lab_stock_set_updated_at();

drop trigger if exists out_lab_contract_stage_history_append_only on public.out_lab_contract_stage_history;
create trigger out_lab_contract_stage_history_append_only
before update or delete on public.out_lab_contract_stage_history
for each row execute function public.prevent_append_only_mutation();

drop trigger if exists out_lab_responsible_audit_append_only on public.out_lab_responsible_audit;
create trigger out_lab_responsible_audit_append_only
before update or delete on public.out_lab_responsible_audit
for each row execute function public.prevent_append_only_mutation();

alter table public.out_lab_contracts enable row level security;
alter table public.out_lab_monthly_usage enable row level security;
alter table public.out_lab_contract_stage_history enable row level security;
alter table public.out_lab_responsible_audit enable row level security;

revoke all on table public.out_lab_contracts from anon, authenticated;
revoke all on table public.out_lab_monthly_usage from anon, authenticated;
revoke all on table public.out_lab_contract_stage_history from anon, authenticated;
revoke all on table public.out_lab_responsible_audit from anon, authenticated;

-- Authenticated clients read only. Every write goes through an RPC called with
-- the service role, which is where the ceiling and the one-row-per-month rule
-- are enforced under a lock.
grant select on table public.out_lab_contracts to authenticated;
grant select on table public.out_lab_monthly_usage to authenticated;
grant select on table public.out_lab_contract_stage_history to authenticated;
grant select on table public.out_lab_responsible_audit to authenticated;

grant select, insert, update, delete on table public.out_lab_contracts to service_role;
grant select, insert, update, delete on table public.out_lab_monthly_usage to service_role;
grant select, insert, update, delete on table public.out_lab_contract_stage_history to service_role;
grant select, insert on table public.out_lab_responsible_audit to service_role;

drop policy if exists out_lab_contracts_app_read on public.out_lab_contracts;
create policy out_lab_contracts_app_read
on public.out_lab_contracts for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (profile.ephis_id = '9495' or profile.role = 'Manager')
  )
);

drop policy if exists out_lab_monthly_usage_app_read on public.out_lab_monthly_usage;
create policy out_lab_monthly_usage_app_read
on public.out_lab_monthly_usage for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (profile.ephis_id = '9495' or profile.role = 'Manager')
  )
);

drop policy if exists out_lab_contract_stage_history_app_read on public.out_lab_contract_stage_history;
create policy out_lab_contract_stage_history_app_read
on public.out_lab_contract_stage_history for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (profile.ephis_id = '9495' or profile.role = 'Manager')
  )
);

-- Who may spend against a contract is management information, so the audit
-- trail is narrower than the register itself.
drop policy if exists out_lab_responsible_audit_app_read on public.out_lab_responsible_audit;
create policy out_lab_responsible_audit_app_read
on public.out_lab_responsible_audit for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'head')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

commit;
