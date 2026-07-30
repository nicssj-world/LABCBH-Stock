-- Equipment leases are billed monthly in baht, not drawn down as stock. The
-- portal already tracks this in public.contract_usage and has two years of
-- history there, so this migration extends that table rather than replacing it.
begin;

-- recorded_by holds a display name copied at write time. New rows get a real
-- identity; the text column stays so existing history keeps its attribution.
alter table public.contract_usage
  add column if not exists recorded_by_id uuid references public.profiles(id) on delete set null;

create index if not exists contract_usage_contract_month_idx
  on public.contract_usage (contract_id, usage_month desc);
create index if not exists contract_usage_recorded_by_id_idx
  on public.contract_usage (recorded_by_id) where recorded_by_id is not null;

-- Being listed on a contract is the right to spend against it, so changes are
-- recorded the same way membership changes are.
create table if not exists public.contract_responsible_audit (
  id uuid primary key default gen_random_uuid(),
  contract_id bigint not null references public.contracts(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  previous_assigned boolean,
  next_assigned boolean not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists contract_responsible_audit_contract_idx
  on public.contract_responsible_audit (contract_id, created_at desc);
create index if not exists contract_responsible_audit_profile_idx
  on public.contract_responsible_audit (profile_id, created_at desc);

drop trigger if exists contract_responsible_audit_append_only on public.contract_responsible_audit;
create trigger contract_responsible_audit_append_only
before update or delete on public.contract_responsible_audit
for each row execute function public.prevent_append_only_mutation();

-- Refuse to install the guard against data it would already reject. Production
-- has no such contract today - all 16 leases carry zero line items - but that
-- must be proven at apply time, not assumed, or the migration half-applies and
-- leaves a table nobody can write to.
do $preflight$
declare
  conflicting bigint;
begin
  select count(*) into conflicting
  from public.contracts contract
  where (
    contract.contract_type = 'equipment_lease'
    and exists (select 1 from public.contract_items item where item.contract_id = contract.id)
  ) or (
    contract.contract_type is distinct from 'equipment_lease'
    and exists (select 1 from public.contract_usage usage where usage.contract_id = contract.id)
  );

  if conflicting > 0 then
    raise exception using
      errcode = '23514',
      message = format('%s contract(s) already mix budget and line-item tracking', conflicting),
      hint = 'reclassify those contracts before installing the mode guard';
  end if;
end
$preflight$;

-- The two tracking models are mutually exclusive. Allowing both on one contract
-- would produce a budget balance and an allocation balance that disagree, with
-- no way to say which is the truth.
create or replace function public.guard_contract_tracking_mode()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_type text;
begin
  -- Both contract_usage and contract_items carry contract_id, so one lookup
  -- serves both triggers.
  select contract.contract_type into target_type
  from public.contracts contract
  where contract.id = new.contract_id;

  if tg_argv[0] = 'usage' and target_type is distinct from 'equipment_lease' then
    raise exception using
      errcode = '23514',
      message = 'budget entries are only valid on an equipment lease contract';
  end if;

  if tg_argv[0] = 'items' and target_type = 'equipment_lease' then
    raise exception using
      errcode = '23514',
      message = 'an equipment lease contract is tracked by budget and cannot hold line items';
  end if;

  return new;
end
$function$;

revoke execute on function public.guard_contract_tracking_mode() from public;
revoke execute on function public.guard_contract_tracking_mode() from anon;
revoke execute on function public.guard_contract_tracking_mode() from authenticated;

drop trigger if exists contract_usage_mode_guard on public.contract_usage;
create trigger contract_usage_mode_guard
before insert or update on public.contract_usage
for each row execute function public.guard_contract_tracking_mode('usage');

drop trigger if exists contract_items_mode_guard on public.contract_items;
create trigger contract_items_mode_guard
before insert or update on public.contract_items
for each row execute function public.guard_contract_tracking_mode('items');

alter table public.contract_responsible_audit enable row level security;
alter table public.contract_usage enable row level security;

revoke all on table public.contract_responsible_audit from anon, authenticated;
grant select on table public.contract_responsible_audit to authenticated;
grant select, insert on table public.contract_responsible_audit to service_role;

grant select, insert, update, delete on table public.contract_usage to service_role;

drop policy if exists contract_responsible_audit_app_read on public.contract_responsible_audit;
create policy contract_responsible_audit_app_read
on public.contract_responsible_audit for select
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

-- Contract documents, separate from the lab-stock-po receiving evidence.
insert into storage.buckets (id, name, public)
values ('lab-stock-contracts', 'lab-stock-contracts', false)
on conflict (id) do update set public = false;

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'lab-stock-contracts';

commit;
