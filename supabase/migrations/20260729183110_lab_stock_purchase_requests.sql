-- LABCBH Stock — purchase requests and atomic contract allocation.
--
-- Contracted quantity moves at exactly one moment: when a stock officer
-- confirms a pending PR. That confirmation is a single plpgsql transaction that
-- locks the PR row, re-reads its status under the lock, and writes one
-- allocation per line. The ceiling itself is enforced by the Task 2 trigger on
-- contract_item_allocations, so no caller can bypass it.

begin;

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  sequence_number integer not null check (sequence_number > 0),
  document_number text not null check (nullif(btrim(document_number), '') is not null),
  requester_id uuid references public.profiles(id) on delete restrict,
  department text not null check (nullif(btrim(department), '') is not null),
  -- Snapshots, so a completed PR still prints correctly after staff change.
  head_name text not null check (nullif(btrim(head_name), '') is not null),
  requested_date date not null,
  purchase_method text not null check (purchase_method in (
    'annual_plan',
    'contract',
    'awaiting_contract',
    'off_plan',
    'specific_contract',
    'e_bidding'
  )),
  method_details jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in (
    'draft',
    'pending',
    'completed',
    'cancelled',
    'reversed'
  )),
  po_number text,
  note text,
  acknowledged_by uuid references public.profiles(id) on delete restrict,
  acknowledged_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (fiscal_year, sequence_number),
  constraint purchase_requests_acknowledgement_check check (
    (status in ('completed', 'reversed')) = (acknowledged_by is not null)
    and (acknowledged_by is null) = (acknowledged_at is null)
  ),
  constraint purchase_requests_reversal_check check (
    (status = 'reversed') = (reversed_at is not null)
    and (reversed_at is null) = (reversed_by is null)
  )
);

create table if not exists public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  contract_item_id uuid references public.contract_items(id) on delete restrict,
  -- Captured at submission so the reviewer judges the same numbers the
  -- requester saw, even if stock moved in between.
  monthly_usage_snapshot numeric(15,3) not null default 0 check (monthly_usage_snapshot >= 0),
  on_hand_snapshot numeric(15,3) not null default 0,
  requested_quantity numeric(15,3) not null check (requested_quantity > 0),
  unit text not null check (nullif(btrim(unit), '') is not null),
  unit_price numeric(15,2) not null check (unit_price >= 0),
  line_total numeric(17,2) generated always as (round(requested_quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now(),
  unique (purchase_request_id, line_number),
  unique (purchase_request_id, inventory_item_id)
);

-- The Task 2 allocation column was created before this table existed; wire up
-- the real foreign key now.
alter table public.contract_item_allocations
  drop constraint if exists contract_item_allocations_purchase_request_item_id_fkey;

alter table public.contract_item_allocations
  add constraint contract_item_allocations_purchase_request_item_id_fkey
  foreign key (purchase_request_item_id)
  references public.purchase_request_items(id)
  on delete restrict;

create unique index if not exists purchase_requests_document_number_key
  on public.purchase_requests (lower(btrim(document_number)));
create unique index if not exists purchase_requests_po_number_key
  on public.purchase_requests (lower(btrim(po_number)))
  where po_number is not null;
create index if not exists purchase_requests_status_idx
  on public.purchase_requests (status, requested_date desc);
create index if not exists purchase_requests_requester_idx
  on public.purchase_requests (requester_id) where requester_id is not null;
create index if not exists purchase_requests_acknowledged_by_idx
  on public.purchase_requests (acknowledged_by) where acknowledged_by is not null;
create index if not exists purchase_requests_reversed_by_idx
  on public.purchase_requests (reversed_by) where reversed_by is not null;
create index if not exists purchase_requests_created_by_idx
  on public.purchase_requests (created_by) where created_by is not null;
create index if not exists purchase_requests_updated_by_idx
  on public.purchase_requests (updated_by) where updated_by is not null;
create index if not exists purchase_request_items_request_idx
  on public.purchase_request_items (purchase_request_id, line_number);
create index if not exists purchase_request_items_inventory_item_idx
  on public.purchase_request_items (inventory_item_id);
create unique index if not exists purchase_request_items_contract_item_key
  on public.purchase_request_items (purchase_request_id, contract_item_id)
  where contract_item_id is not null;

drop trigger if exists purchase_requests_set_updated_at on public.purchase_requests;
create trigger purchase_requests_set_updated_at
before update on public.purchase_requests
for each row execute function public.lab_stock_set_updated_at();

create or replace function public.assert_stock_officer_actor(p_actor_id uuid)
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
        profile.ephis_id = '9495'
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
      message = 'actor is not allowed to operate stock';
  end if;
end
$function$;

revoke execute on function public.assert_stock_officer_actor(uuid) from public;
revoke execute on function public.assert_stock_officer_actor(uuid) from anon;
revoke execute on function public.assert_stock_officer_actor(uuid) from authenticated;
grant execute on function public.assert_stock_officer_actor(uuid) to service_role;

create or replace function public.create_purchase_request(
  p_actor_id uuid,
  p_request jsonb,
  p_items jsonb
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_request public.purchase_requests%rowtype;
  parsed_fiscal_year integer;
  parsed_method text;
  next_sequence integer;
  line jsonb;
  line_index integer := 0;
  snapshot_on_hand numeric(15,3);
  snapshot_usage numeric(15,3);
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = '22023', message = 'purchase request payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_request) field_name
    where field_name not in ('fiscalYear', 'department', 'headName', 'requestedDate', 'note', 'method')
  ) then
    raise exception using errcode = '22023', message = 'unexpected purchase request field';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'purchase request must have at least one line';
  end if;

  parsed_fiscal_year := (p_request ->> 'fiscalYear')::integer;
  parsed_method := p_request -> 'method' ->> 'kind';

  if parsed_method is null then
    raise exception using errcode = '22023', message = 'purchase method is required';
  end if;

  -- Serialize numbering for the fiscal year so two submissions cannot claim the
  -- same sequence. An advisory lock keeps this cheap and avoids a counter table.
  perform pg_advisory_xact_lock(hashtext('labcbh_purchase_request_sequence'), parsed_fiscal_year);

  select coalesce(max(request.sequence_number), 0) + 1
  into next_sequence
  from public.purchase_requests request
  where request.fiscal_year = parsed_fiscal_year;

  insert into public.purchase_requests (
    fiscal_year,
    sequence_number,
    document_number,
    requester_id,
    department,
    head_name,
    requested_date,
    purchase_method,
    method_details,
    status,
    note,
    created_by,
    updated_by
  )
  values (
    parsed_fiscal_year,
    next_sequence,
    'PR-' || parsed_fiscal_year || '-' || lpad(next_sequence::text, 4, '0'),
    p_actor_id,
    btrim(p_request ->> 'department'),
    btrim(p_request ->> 'headName'),
    (p_request ->> 'requestedDate')::date,
    parsed_method,
    (p_request -> 'method') - 'kind',
    'pending',
    nullif(btrim(coalesce(p_request ->> 'note', '')), ''),
    p_actor_id,
    p_actor_id
  )
  returning * into created_request;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_index := line_index + 1;

    -- Snapshots are taken server-side; a browser value could be stale or forged.
    select coalesce(balance.on_hand, 0)
    into snapshot_on_hand
    from public.inventory_item_balances balance
    where balance.inventory_item_id = (line ->> 'inventoryItemId')::uuid;

    select coalesce(avg(issues.issued_quantity), 0)
    into snapshot_usage
    from public.inventory_item_monthly_issues issues
    where issues.inventory_item_id = (line ->> 'inventoryItemId')::uuid
      and issues.issue_month >= (date_trunc('month', current_date) - interval '3 months')::date
      and issues.issue_month < date_trunc('month', current_date)::date;

    insert into public.purchase_request_items (
      purchase_request_id,
      line_number,
      inventory_item_id,
      contract_item_id,
      monthly_usage_snapshot,
      on_hand_snapshot,
      requested_quantity,
      unit,
      unit_price
    )
    values (
      created_request.id,
      line_index,
      (line ->> 'inventoryItemId')::uuid,
      nullif(line ->> 'contractItemId', '')::uuid,
      coalesce(snapshot_usage, 0),
      coalesce(snapshot_on_hand, 0),
      (line ->> 'requestedQuantity')::numeric,
      btrim(line ->> 'unit'),
      (line ->> 'unitPrice')::numeric
    );
  end loop;

  return created_request;
end
$function$;

revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from public;
revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from anon;
revoke execute on function public.create_purchase_request(uuid, jsonb, jsonb) from authenticated;
grant execute on function public.create_purchase_request(uuid, jsonb, jsonb) to service_role;

create or replace function public.confirm_purchase_request(
  p_pr_id uuid,
  p_actor_id uuid
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  confirmed_request public.purchase_requests%rowtype;
  line public.purchase_request_items%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  -- Lock first, then re-read status under the lock. Checking before locking
  -- would let two officers both see 'pending' and both allocate.
  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if locked_request.status <> 'pending' then
    raise exception using
      errcode = '55000',
      message = format('purchase request is %s and cannot be confirmed', locked_request.status);
  end if;

  for line in
    select *
    from public.purchase_request_items item
    where item.purchase_request_id = p_pr_id
    order by item.line_number
  loop
    if line.contract_item_id is not null then
      -- validate_contract_item_allocation locks the contract item and rejects
      -- anything over the contracted quantity, so the ceiling holds even under
      -- concurrent confirmations.
      insert into public.contract_item_allocations (
        contract_item_id,
        purchase_request_item_id,
        allocation_kind,
        quantity,
        created_by
      )
      values (
        line.contract_item_id,
        line.id,
        'purchase_request',
        line.requested_quantity,
        p_actor_id
      );
    end if;
  end loop;

  update public.purchase_requests
  set status = 'completed',
      acknowledged_by = p_actor_id,
      acknowledged_at = now(),
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into confirmed_request;

  return confirmed_request;
end
$function$;

revoke execute on function public.confirm_purchase_request(uuid, uuid) from public;
revoke execute on function public.confirm_purchase_request(uuid, uuid) from anon;
revoke execute on function public.confirm_purchase_request(uuid, uuid) from authenticated;
grant execute on function public.confirm_purchase_request(uuid, uuid) to service_role;

create or replace function public.reverse_purchase_request(
  p_pr_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  reversed_request public.purchase_requests%rowtype;
  original public.contract_item_allocations%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '23514', message = 'reversal requires a reason';
  end if;

  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if locked_request.status <> 'completed' then
    raise exception using
      errcode = '55000',
      message = format('purchase request is %s and cannot be reversed', locked_request.status);
  end if;

  -- Compensating rows only. The append-only trigger would reject a delete, and
  -- the audit trail must keep showing what was committed and by whom.
  for original in
    select allocation.*
    from public.contract_item_allocations allocation
    join public.purchase_request_items item on item.id = allocation.purchase_request_item_id
    where item.purchase_request_id = p_pr_id
      and allocation.allocation_kind = 'purchase_request'
  loop
    insert into public.contract_item_allocations (
      contract_item_id,
      allocation_kind,
      quantity,
      reference_allocation_id,
      note,
      created_by
    )
    values (
      original.contract_item_id,
      'reversal',
      -original.quantity,
      original.id,
      btrim(p_reason),
      p_actor_id
    );
  end loop;

  update public.purchase_requests
  set status = 'reversed',
      reversed_by = p_actor_id,
      reversed_at = now(),
      reversal_reason = btrim(p_reason),
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into reversed_request;

  return reversed_request;
end
$function$;

revoke execute on function public.reverse_purchase_request(uuid, uuid, text) from public;
revoke execute on function public.reverse_purchase_request(uuid, uuid, text) from anon;
revoke execute on function public.reverse_purchase_request(uuid, uuid, text) from authenticated;
grant execute on function public.reverse_purchase_request(uuid, uuid, text) to service_role;

-- Recording the PO number is a later, separate fact about the same document.
-- It deliberately touches no allocation.
create or replace function public.set_purchase_order_number(
  p_pr_id uuid,
  p_actor_id uuid,
  p_po_number text
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_request public.purchase_requests%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if nullif(btrim(coalesce(p_po_number, '')), '') is null then
    raise exception using errcode = '23514', message = 'purchase order number is required';
  end if;

  update public.purchase_requests
  set po_number = btrim(p_po_number),
      updated_by = p_actor_id
  where id = p_pr_id
    and status = 'completed'
  returning * into updated_request;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'only a confirmed purchase request can record a purchase order number';
  end if;

  return updated_request;
end
$function$;

revoke execute on function public.set_purchase_order_number(uuid, uuid, text) from public;
revoke execute on function public.set_purchase_order_number(uuid, uuid, text) from anon;
revoke execute on function public.set_purchase_order_number(uuid, uuid, text) from authenticated;
grant execute on function public.set_purchase_order_number(uuid, uuid, text) to service_role;

alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;

revoke all on table public.purchase_requests from anon, authenticated;
revoke all on table public.purchase_request_items from anon, authenticated;

grant select on table public.purchase_requests to authenticated;
grant select on table public.purchase_request_items to authenticated;

grant select, insert, update, delete on table public.purchase_requests to service_role;
grant select, insert, update, delete on table public.purchase_request_items to service_role;

drop policy if exists purchase_requests_app_read on public.purchase_requests;
create policy purchase_requests_app_read
on public.purchase_requests for select
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

drop policy if exists purchase_request_items_app_read on public.purchase_request_items;
create policy purchase_request_items_app_read
on public.purchase_request_items for select
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

commit;
