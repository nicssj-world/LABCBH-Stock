begin;

-- This app intentionally extends the shared lab-management-portal schema.
-- Fail with a clear message rather than creating an incompatible shadow schema.
do $migration$
begin
  if to_regclass('public.contracts') is null or to_regclass('public.profiles') is null then
    raise exception using
      errcode = '42P01',
      message = 'LABCBH Stock requires the shared public.contracts and public.profiles tables';
  end if;
end
$migration$;

-- Empty legacy values mean "not assigned" and are normalized without changing
-- any real contract number or legacy ID.
update public.contracts
set contract_number = null
where contract_number is not null
  and nullif(btrim(contract_number), '') is null;

do $duplicates$
begin
  if exists (
    select 1
    from public.contracts
    where contract_number is not null
    group by lower(btrim(contract_number))
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate legacy contract numbers must be reconciled before LABCBH Stock migration';
  end if;
end
$duplicates$;

alter table public.contracts
  add column if not exists fiscal_year integer,
  add column if not exists contract_type text,
  add column if not exists procurement_stage text,
  add column if not exists display_name text,
  add column if not exists is_archived boolean default false,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists portal_updated_at timestamptz,
  add column if not exists sent_to_procurement_date date,
  add column if not exists plan_published_date date,
  add column if not exists tender_announced_date date,
  add column if not exists result_consideration_date date,
  add column if not exists winner_announced_date date,
  add column if not exists contract_started_date date,
  add column if not exists stage_updated_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

update public.contracts
set
  fiscal_year = coalesce(
    fiscal_year,
    extract(year from coalesce(start_date, created_at::date, current_date))::integer
      + case
          when extract(month from coalesce(start_date, created_at::date, current_date)) >= 10
            then 544
          else 543
        end
  ),
  contract_type = coalesce(contract_type, 'equipment_lease'),
  procurement_stage = coalesce(procurement_stage, 'contract_started'),
  display_name = coalesce(nullif(btrim(display_name), ''), product),
  updated_at = coalesce(updated_at, created_at, now()),
  contract_started_date = coalesce(contract_started_date, start_date, created_at::date),
  stage_updated_at = coalesce(stage_updated_at, created_at, now())
where contract_type is null
  and procurement_stage is null
  and display_name is null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_fiscal_year_check'
  ) then
    alter table public.contracts
      add constraint contracts_fiscal_year_check
      check (fiscal_year between 2500 and 3000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_contract_type_check'
  ) then
    alter table public.contracts
      add constraint contracts_contract_type_check
      check (contract_type in (
        'equipment_lease',
        'e_bidding',
        'annual_specific',
        'specific',
        'off_plan',
        'awaiting_equipment_lease',
        'thai_red_cross'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_procurement_stage_check'
  ) then
    alter table public.contracts
      add constraint contracts_procurement_stage_check
      check (procurement_stage in (
        'sent_to_procurement',
        'plan_published',
        'tender_announced',
        'result_consideration',
        'winner_announced',
        'contract_started'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_date_order_check'
  ) then
    -- NOT VALID preserves legacy rows while enforcing the rule on new writes.
    alter table public.contracts
      add constraint contracts_date_order_check
      check (start_date is null or end_date is null or end_date >= start_date)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_stage_number_check'
  ) then
    -- Three known legacy started rows have no number. NOT VALID preserves them,
    -- while all inserts and subsequent updates must satisfy the lifecycle rule.
    alter table public.contracts
      add constraint contracts_stage_number_check
      check (
        procurement_stage is null
        or (
          procurement_stage = 'contract_started'
          and nullif(btrim(contract_number), '') is not null
        )
        or (
          procurement_stage <> 'contract_started'
          and contract_number is null
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_lifecycle_status_date_check'
  ) then
    alter table public.contracts
      add constraint contracts_lifecycle_status_date_check
      check (
        procurement_stage is null
        or (
          procurement_stage = 'sent_to_procurement'
          and status is not null
          and status in ('pending', 'cancelled')
          and sent_to_procurement_date is not null
          and plan_published_date is null
          and tender_announced_date is null
          and result_consideration_date is null
          and winner_announced_date is null
          and contract_started_date is null
        )
        or (
          procurement_stage = 'plan_published'
          and status is not null
          and status in ('pending', 'cancelled')
          and sent_to_procurement_date is not null
          and plan_published_date is not null
          and tender_announced_date is null
          and result_consideration_date is null
          and winner_announced_date is null
          and contract_started_date is null
        )
        or (
          procurement_stage = 'tender_announced'
          and status is not null
          and status in ('pending', 'cancelled')
          and sent_to_procurement_date is not null
          and plan_published_date is not null
          and tender_announced_date is not null
          and result_consideration_date is null
          and winner_announced_date is null
          and contract_started_date is null
        )
        or (
          procurement_stage = 'result_consideration'
          and status is not null
          and status in ('pending', 'cancelled')
          and sent_to_procurement_date is not null
          and plan_published_date is not null
          and tender_announced_date is not null
          and result_consideration_date is not null
          and winner_announced_date is null
          and contract_started_date is null
        )
        or (
          procurement_stage = 'winner_announced'
          and status is not null
          and status in ('pending', 'cancelled')
          and sent_to_procurement_date is not null
          and plan_published_date is not null
          and tender_announced_date is not null
          and result_consideration_date is not null
          and winner_announced_date is not null
          and contract_started_date is null
        )
        or (
          procurement_stage = 'contract_started'
          and status is not null
          and status in ('active', 'expired', 'cancelled')
          and nullif(btrim(contract_number), '') is not null
          and start_date is not null
          and contract_started_date is not null
        )
      ) not valid;
  end if;
end
$constraints$;

alter table public.contracts
  alter column vendor drop not null;

create unique index if not exists contracts_contract_number_normalized_key
  on public.contracts (lower(btrim(contract_number)))
  where contract_number is not null
    and nullif(btrim(contract_number), '') is not null;

create index if not exists contracts_lab_stock_dashboard_idx
  on public.contracts (is_archived, fiscal_year desc, procurement_stage);
create index if not exists contracts_contract_type_idx
  on public.contracts (contract_type);
create index if not exists contracts_archived_by_idx
  on public.contracts (archived_by) where archived_by is not null;

create table if not exists public.contract_items (
  id uuid primary key default gen_random_uuid(),
  contract_id bigint not null references public.contracts(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  ls_code text not null check (nullif(btrim(ls_code), '') is not null),
  name text not null check (nullif(btrim(name), '') is not null),
  quantity numeric(15,3) not null check (quantity > 0),
  unit text not null check (nullif(btrim(unit), '') is not null),
  unit_price numeric(15,2) not null check (unit_price > 0),
  line_total numeric(17,2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  source_metadata jsonb not null default '{}'::jsonb,
  unique (contract_id, line_number)
);

create table if not exists public.contract_stage_history (
  id uuid primary key default gen_random_uuid(),
  contract_id bigint not null references public.contracts(id) on delete restrict,
  from_stage text check (
    from_stage is null or from_stage in (
      'sent_to_procurement',
      'plan_published',
      'tender_announced',
      'result_consideration',
      'winner_announced',
      'contract_started'
    )
  ),
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
  source text not null default 'labcbh_stock' check (
    source in ('labcbh_stock', 'legacy_import', 'portal_migration')
  ),
  actor_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (contract_id, to_stage)
);

create table if not exists public.contract_item_allocations (
  id uuid primary key default gen_random_uuid(),
  contract_item_id uuid not null references public.contract_items(id) on delete restrict,
  purchase_request_item_id uuid,
  allocation_kind text not null default 'purchase_request' check (
    allocation_kind in ('purchase_request', 'reversal', 'legacy_import')
  ),
  quantity numeric(15,3) not null check (quantity <> 0),
  reference_allocation_id uuid references public.contract_item_allocations(id) on delete restrict,
  source_identity text,
  source_metadata jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  check (
    (
      allocation_kind = 'purchase_request'
      and quantity > 0
      and purchase_request_item_id is not null
      and reference_allocation_id is null
      and source_identity is null
    )
    or (
      allocation_kind = 'legacy_import'
      and quantity > 0
      and purchase_request_item_id is null
      and reference_allocation_id is null
      and nullif(btrim(source_identity), '') is not null
      and source_metadata <> '{}'::jsonb
    )
    or (
      allocation_kind = 'reversal'
      and quantity < 0
      and purchase_request_item_id is null
      and reference_allocation_id is not null
      and source_identity is null
    )
  )
);

create table if not exists public.lab_stock_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'head', 'stock_officer', 'viewer', 'reporter')),
  active boolean not null default true,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (profile_id, role)
);

create index if not exists contract_items_created_by_idx
  on public.contract_items (created_by) where created_by is not null;
create index if not exists contract_items_updated_by_idx
  on public.contract_items (updated_by) where updated_by is not null;
create index if not exists contract_stage_history_contract_date_idx
  on public.contract_stage_history (contract_id, effective_date desc);
create index if not exists contract_stage_history_actor_id_idx
  on public.contract_stage_history (actor_id) where actor_id is not null;
create index if not exists contract_stage_history_source_idx
  on public.contract_stage_history (source, effective_date desc);
create index if not exists contract_items_source_metadata_idx
  on public.contract_items using gin (source_metadata);
create index if not exists contract_item_allocations_contract_item_id_idx
  on public.contract_item_allocations (contract_item_id);
create unique index if not exists contract_item_allocations_pr_item_key
  on public.contract_item_allocations (purchase_request_item_id)
  where allocation_kind = 'purchase_request';
create unique index if not exists contract_item_allocations_reversal_reference_key
  on public.contract_item_allocations (reference_allocation_id)
  where allocation_kind = 'reversal';
create unique index if not exists contract_item_allocations_legacy_source_identity_key
  on public.contract_item_allocations (source_identity)
  where allocation_kind = 'legacy_import';
create index if not exists contract_item_allocations_created_by_idx
  on public.contract_item_allocations (created_by) where created_by is not null;
create index if not exists lab_stock_memberships_active_role_idx
  on public.lab_stock_memberships (role, profile_id) where active;
create index if not exists lab_stock_memberships_granted_by_idx
  on public.lab_stock_memberships (granted_by) where granted_by is not null;
create index if not exists lab_stock_memberships_updated_by_idx
  on public.lab_stock_memberships (updated_by) where updated_by is not null;

create or replace function public.lab_stock_set_updated_at()
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

revoke execute on function public.lab_stock_set_updated_at() from public;
revoke execute on function public.lab_stock_set_updated_at() from anon;
revoke execute on function public.lab_stock_set_updated_at() from authenticated;

drop trigger if exists contracts_lab_stock_set_updated_at on public.contracts;
create trigger contracts_lab_stock_set_updated_at
before update on public.contracts
for each row execute function public.lab_stock_set_updated_at();

drop trigger if exists contract_items_set_updated_at on public.contract_items;
create trigger contract_items_set_updated_at
before update on public.contract_items
for each row execute function public.lab_stock_set_updated_at();

drop trigger if exists lab_stock_memberships_set_updated_at on public.lab_stock_memberships;
create trigger lab_stock_memberships_set_updated_at
before update on public.lab_stock_memberships
for each row execute function public.lab_stock_set_updated_at();

create or replace function public.prevent_append_only_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%s is append-only; insert a compensating record instead', tg_table_name);
end
$function$;

revoke execute on function public.prevent_append_only_mutation() from public;
revoke execute on function public.prevent_append_only_mutation() from anon;
revoke execute on function public.prevent_append_only_mutation() from authenticated;

drop trigger if exists contract_stage_history_append_only on public.contract_stage_history;
create trigger contract_stage_history_append_only
before update or delete on public.contract_stage_history
for each row execute function public.prevent_append_only_mutation();

drop trigger if exists contract_item_allocations_append_only on public.contract_item_allocations;
create trigger contract_item_allocations_append_only
before update or delete on public.contract_item_allocations
for each row execute function public.prevent_append_only_mutation();

create or replace function public.validate_contract_item_allocation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  contracted_quantity numeric(15,3);
  committed_quantity numeric(15,3);
  original_allocation public.contract_item_allocations%rowtype;
begin
  -- This parent-row lock serializes every allocation for one contract item.
  select item.quantity
  into contracted_quantity
  from public.contract_items item
  where item.id = new.contract_item_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'contract item not found';
  end if;

  select coalesce(sum(allocation.quantity), 0)
  into committed_quantity
  from public.contract_item_allocations allocation
  where allocation.contract_item_id = new.contract_item_id;

  if new.allocation_kind = 'reversal' then
    select allocation.*
    into original_allocation
    from public.contract_item_allocations allocation
    where allocation.id = new.reference_allocation_id
    for share;

    if not found
      or original_allocation.allocation_kind = 'reversal'
      or original_allocation.quantity <= 0
      or original_allocation.contract_item_id <> new.contract_item_id
      or new.quantity <> -original_allocation.quantity
    then
      raise exception using
        errcode = '23514',
        message = 'reversal must exactly negate its original allocation for the same contract item';
    end if;
  end if;

  if committed_quantity + new.quantity > contracted_quantity then
    raise exception using errcode = '23514', message = 'allocation exceeds contracted quantity';
  end if;

  if committed_quantity + new.quantity < 0 then
    raise exception using errcode = '23514', message = 'allocation would make committed quantity negative';
  end if;

  return new;
end
$function$;

revoke execute on function public.validate_contract_item_allocation() from public;
revoke execute on function public.validate_contract_item_allocation() from anon;
revoke execute on function public.validate_contract_item_allocation() from authenticated;

drop trigger if exists contract_item_allocations_validate_insert on public.contract_item_allocations;
create trigger contract_item_allocations_validate_insert
before insert on public.contract_item_allocations
for each row execute function public.validate_contract_item_allocation();

insert into public.lab_stock_memberships (profile_id, role, active)
select p.id, seed.role, true
from (
  values
    ('9495'::text, 'admin'::text),
    ('14812'::text, 'stock_officer'::text),
    ('11050'::text, 'stock_officer'::text)
) as seed(ephis_id, role)
join public.profiles p on p.ephis_id = seed.ephis_id
on conflict (profile_id, role) do nothing;

alter table public.contract_items enable row level security;
alter table public.contract_stage_history enable row level security;
alter table public.contract_item_allocations enable row level security;
alter table public.lab_stock_memberships enable row level security;
alter table public.contracts enable row level security;

revoke all on table public.contracts from anon, authenticated;
revoke all on table public.contract_items from anon, authenticated;
revoke all on table public.contract_stage_history from anon, authenticated;
revoke all on table public.contract_item_allocations from anon, authenticated;
revoke all on table public.lab_stock_memberships from anon, authenticated;

-- Authenticated clients have SELECT-only access; initial history is created atomically in Task 3.
grant select on table public.contracts to authenticated;
grant select on table public.contract_items to authenticated;
grant select on table public.contract_stage_history to authenticated;
grant select on table public.contract_item_allocations to authenticated;
grant select on table public.lab_stock_memberships to authenticated;

grant select, insert, update, delete on table public.contracts to service_role;
grant select, insert, update, delete on table public.contract_items to service_role;
grant select, insert, update, delete on table public.contract_stage_history to service_role;
grant select, insert, update, delete on table public.contract_item_allocations to service_role;
grant select, insert, update, delete on table public.lab_stock_memberships to service_role;

-- Replace the portal's broad PUBLIC/auth.role() policies. The table and all
-- legacy columns/IDs remain in place, while app access becomes explicit.
drop policy if exists contracts_auth_read on public.contracts;
drop policy if exists contracts_staff_write on public.contracts;
drop policy if exists contracts_lab_stock_app_read on public.contracts;
create policy contracts_lab_stock_app_read
on public.contracts for select
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

drop policy if exists contracts_lab_stock_head_write on public.contracts;
drop policy if exists contracts_lab_stock_head_insert on public.contracts;
drop policy if exists contracts_lab_stock_head_delete on public.contracts;

drop policy if exists contract_items_app_read on public.contract_items;
create policy contract_items_app_read
on public.contract_items for select
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

drop policy if exists contract_items_head_write on public.contract_items;
drop policy if exists contract_items_head_insert on public.contract_items;
drop policy if exists contract_items_head_delete on public.contract_items;

drop policy if exists contract_stage_history_app_read on public.contract_stage_history;
create policy contract_stage_history_app_read
on public.contract_stage_history for select
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

drop policy if exists contract_item_allocations_app_read on public.contract_item_allocations;
create policy contract_item_allocations_app_read
on public.contract_item_allocations for select
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

drop policy if exists lab_stock_memberships_self_or_admin_read on public.lab_stock_memberships;
create policy lab_stock_memberships_self_or_admin_read
on public.lab_stock_memberships for select
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile_id = (select auth.uid())
        or profile.ephis_id = '9495'
      )
  )
);

drop policy if exists lab_stock_memberships_admin_write on public.lab_stock_memberships;
drop policy if exists lab_stock_memberships_admin_insert on public.lab_stock_memberships;
drop policy if exists lab_stock_memberships_admin_delete on public.lab_stock_memberships;

create or replace function public.advance_contract_stage(
  p_contract_id bigint,
  p_actor_id uuid,
  p_to_stage text,
  p_effective_date date,
  p_contract_number text default null,
  p_note text default null
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_contract public.contracts%rowtype;
  expected_stage text;
  normalized_contract_number text;
  latest_effective_date date;
begin
  if p_effective_date is null then
    raise exception using errcode = '22004', message = 'effective date is required';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.ephis_id = '9495'
        or profile.role = 'Manager'
        or exists (
          select 1
          from public.lab_stock_memberships membership
          where membership.profile_id = profile.id
            and membership.active
            and membership.role in ('admin', 'head')
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'actor is not allowed to advance contract stages';
  end if;

  select contract.*
  into current_contract
  from public.contracts contract
  where contract.id = p_contract_id
    and not coalesce(contract.is_archived, false)
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'active contract not found';
  end if;

  select max(history.effective_date)
  into latest_effective_date
  from public.contract_stage_history history
  where history.contract_id = p_contract_id;

  if latest_effective_date is not null and p_effective_date < latest_effective_date then
    raise exception using
      errcode = '22007',
      message = 'effective date cannot precede the latest contract history';
  end if;

  expected_stage := case current_contract.procurement_stage
    when 'sent_to_procurement' then 'plan_published'
    when 'plan_published' then 'tender_announced'
    when 'tender_announced' then 'result_consideration'
    when 'result_consideration' then 'winner_announced'
    when 'winner_announced' then 'contract_started'
    else null
  end;

  if expected_stage is null or p_to_stage is distinct from expected_stage then
    raise exception using
      errcode = '22023',
      message = format(
        'invalid procurement-stage transition from %s to %s',
        current_contract.procurement_stage,
        coalesce(p_to_stage, '<null>')
      );
  end if;

  normalized_contract_number := nullif(btrim(p_contract_number), '');

  if p_to_stage = 'contract_started' then
    if normalized_contract_number is null then
      raise exception using errcode = '23502', message = 'contract number is required when starting a contract';
    end if;

    if exists (
      select 1
      from public.contracts contract
      where contract.id <> p_contract_id
        and contract.contract_number is not null
        and lower(btrim(contract.contract_number)) = lower(normalized_contract_number)
    ) then
      raise exception using errcode = '23505', message = 'contract number is already in use';
    end if;
  elsif normalized_contract_number is not null then
    raise exception using errcode = '22023', message = 'contract number may only be set when starting a contract';
  end if;

  update public.contracts
  set
    procurement_stage = p_to_stage,
    contract_number = case
      when p_to_stage = 'contract_started' then normalized_contract_number
      else contract_number
    end,
    start_date = case
      when p_to_stage = 'contract_started' then p_effective_date
      else start_date
    end,
    plan_published_date = case
      when p_to_stage = 'plan_published' then p_effective_date
      else plan_published_date
    end,
    tender_announced_date = case
      when p_to_stage = 'tender_announced' then p_effective_date
      else tender_announced_date
    end,
    result_consideration_date = case
      when p_to_stage = 'result_consideration' then p_effective_date
      else result_consideration_date
    end,
    winner_announced_date = case
      when p_to_stage = 'winner_announced' then p_effective_date
      else winner_announced_date
    end,
    contract_started_date = case
      when p_to_stage = 'contract_started' then p_effective_date
      else contract_started_date
    end,
    stage_updated_at = now(),
    status = case
      when p_to_stage = 'contract_started' then 'active'
      else status
    end
  where id = p_contract_id
  returning * into current_contract;

  insert into public.contract_stage_history (
    contract_id,
    from_stage,
    to_stage,
    effective_date,
    contract_number_snapshot,
    note,
    source,
    actor_id
  ) values (
    p_contract_id,
    case
      when p_to_stage = 'plan_published' then 'sent_to_procurement'
      when p_to_stage = 'tender_announced' then 'plan_published'
      when p_to_stage = 'result_consideration' then 'tender_announced'
      when p_to_stage = 'winner_announced' then 'result_consideration'
      when p_to_stage = 'contract_started' then 'winner_announced'
    end,
    p_to_stage,
    p_effective_date,
    current_contract.contract_number,
    nullif(btrim(p_note), ''),
    'labcbh_stock',
    p_actor_id
  );

  return current_contract;
end
$function$;

revoke execute on function public.advance_contract_stage(bigint, uuid, text, date, text, text) from public;
revoke execute on function public.advance_contract_stage(bigint, uuid, text, date, text, text) from anon;
revoke execute on function public.advance_contract_stage(bigint, uuid, text, date, text, text) from authenticated;
grant execute on function public.advance_contract_stage(bigint, uuid, text, date, text, text) to service_role;

commit;
