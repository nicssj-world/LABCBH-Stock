-- LABCBH Stock — one-time workbook import, reconciliation evidence, and
-- separately approved physical opening counts.
--
-- The client produces a deterministic plan and report. Only service_role may
-- call these security-invoker transactions, and the database independently
-- checks the app administrator before touching shared operational tables.

begin;

create table if not exists public.lab_stock_import_runs (
  id uuid primary key default gen_random_uuid(),
  report_hash text not null unique check (report_hash ~ '^[0-9a-f]{64}$'),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  reconciliation_report jsonb not null check (jsonb_typeof(reconciliation_report) = 'object'),
  status text not null default 'applied' check (status = 'applied'),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.lab_stock_opening_count_batches (
  id uuid primary key default gen_random_uuid(),
  report_hash text not null unique check (report_hash ~ '^[0-9a-f]{64}$'),
  count_date date not null,
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists lab_stock_import_runs_actor_idx
  on public.lab_stock_import_runs (actor_id, applied_at desc);
create index if not exists lab_stock_opening_count_batches_approver_idx
  on public.lab_stock_opening_count_batches (approved_by, count_date desc);

drop trigger if exists lab_stock_import_runs_append_only on public.lab_stock_import_runs;
create trigger lab_stock_import_runs_append_only
before update or delete on public.lab_stock_import_runs
for each row execute function public.prevent_append_only_mutation();

drop trigger if exists lab_stock_opening_count_batches_append_only on public.lab_stock_opening_count_batches;
create trigger lab_stock_opening_count_batches_append_only
before update or delete on public.lab_stock_opening_count_batches
for each row execute function public.prevent_append_only_mutation();

create or replace function public.apply_lab_stock_import(
  p_plan jsonb,
  p_reconciliation_report jsonb,
  p_report_hash text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  import_run_id uuid;
  contract_row jsonb;
  item_row jsonb;
  inventory_row jsonb;
  alias_row jsonb;
  allocation_row jsonb;
  contract_id_value bigint;
  contract_item_id_value uuid;
  inventory_item_id_value uuid;
  existing_contract public.contracts%rowtype;
  expected_total numeric;
begin
  perform public.assert_lab_stock_admin_actor(p_actor_id);

  if p_plan is null or p_plan->>'version' <> '1' then
    raise exception using errcode = '22023', message = 'unsupported import plan version';
  end if;
  if p_reconciliation_report is null or p_reconciliation_report->>'version' <> '1' then
    raise exception using errcode = '22023', message = 'unsupported reconciliation report version';
  end if;
  if p_report_hash is null or p_report_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid reconciliation report hash';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_plan->'conflicts', '[]'::jsonb)) conflict
    where conflict->>'kind' = 'contract_identity'
  ) then
    raise exception using errcode = '23514', message = 'contract identity conflicts must be resolved before import';
  end if;

  select run.id into import_run_id
  from public.lab_stock_import_runs run
  where run.report_hash = p_report_hash;
  if import_run_id is not null then
    return import_run_id;
  end if;

  import_run_id := gen_random_uuid();
  insert into public.lab_stock_import_runs (
    id, report_hash, plan, reconciliation_report, actor_id
  ) values (
    import_run_id, p_report_hash, p_plan, p_reconciliation_report, p_actor_id
  );

  for contract_row in
    select value from jsonb_array_elements(coalesce(p_plan->'contracts', '[]'::jsonb))
  loop
    select * into existing_contract
    from public.contracts contract
    where lower(btrim(contract.contract_number)) = lower(btrim(contract_row->>'contractNumber'))
    for update;

    select coalesce(sum(
      (line->>'quantity')::numeric * (line->>'unitPrice')::numeric
    ), 0)
    into expected_total
    from jsonb_array_elements(coalesce(p_plan->'contractItems', '[]'::jsonb)) line
    where lower(btrim(line->>'contractNumber')) = lower(btrim(contract_row->>'contractNumber'));

    if existing_contract.id is not null then
      if existing_contract.fiscal_year is not null
        and existing_contract.fiscal_year <> (contract_row->>'fiscalYear')::integer
      then
        raise exception using errcode = '23514', message = 'existing contract fiscal year does not match import identity';
      end if;
      if nullif(btrim(coalesce(existing_contract.vendor, '')), '') is not null
        and lower(btrim(existing_contract.vendor)) <> lower(btrim(contract_row->>'vendor'))
      then
        raise exception using errcode = '23514', message = 'existing contract vendor does not match import identity';
      end if;

      update public.contracts
      set display_name = contract_row->>'displayName',
          vendor = nullif(btrim(contract_row->>'vendor'), ''),
          product = contract_row->>'product',
          total = expected_total,
          start_date = (contract_row->>'startDate')::date,
          end_date = (contract_row->>'endDate')::date,
          fiscal_year = (contract_row->>'fiscalYear')::integer,
          contract_type = contract_row->>'contractType',
          procurement_stage = 'contract_started',
          status = case
            when (contract_row->>'endDate')::date < current_date then 'expired'
            else 'active'
          end,
          contract_started_date = (contract_row->>'startDate')::date,
          is_archived = false,
          source_metadata = coalesce(source_metadata, '{}'::jsonb)
            || jsonb_build_object('import_run_id', import_run_id, 'source', contract_row->'source'),
          updated_at = now()
      where id = existing_contract.id
      returning id into contract_id_value;
    else
      insert into public.contracts (
        contract_number, display_name, vendor, product, total, start_date, end_date,
        fiscal_year, contract_type, procurement_stage, status,
        contract_started_date, is_archived, source_metadata
      ) values (
        contract_row->>'contractNumber',
        contract_row->>'displayName',
        nullif(btrim(contract_row->>'vendor'), ''),
        contract_row->>'product',
        expected_total,
        (contract_row->>'startDate')::date,
        (contract_row->>'endDate')::date,
        (contract_row->>'fiscalYear')::integer,
        contract_row->>'contractType',
        'contract_started',
        case when (contract_row->>'endDate')::date < current_date then 'expired' else 'active' end,
        (contract_row->>'startDate')::date,
        false,
        jsonb_build_object('import_run_id', import_run_id, 'source', contract_row->'source')
      ) returning id into contract_id_value;
    end if;

    insert into public.contract_stage_history (
      contract_id, from_stage, to_stage, effective_date,
      contract_number_snapshot, note, source, actor_id
    ) values (
      contract_id_value, null, 'contract_started', (contract_row->>'startDate')::date,
      contract_row->>'contractNumber', 'นำเข้าจาก Google Sheets', 'legacy_import', p_actor_id
    ) on conflict (contract_id, to_stage) do nothing;
  end loop;

  for item_row in
    select value from jsonb_array_elements(coalesce(p_plan->'contractItems', '[]'::jsonb))
  loop
    select contract.id into contract_id_value
    from public.contracts contract
    where lower(btrim(contract.contract_number)) = lower(btrim(item_row->>'contractNumber'));
    if contract_id_value is null then
      raise exception using errcode = '23503', message = 'import contract item has no matching contract';
    end if;

    insert into public.contract_items (
      contract_id, line_number, ls_code, name, quantity, unit, unit_price,
      created_by, updated_by, source_metadata
    ) values (
      contract_id_value,
      (item_row->>'lineNumber')::integer,
      item_row->>'lsCode',
      item_row->>'name',
      (item_row->>'quantity')::numeric,
      item_row->>'unit',
      (item_row->>'unitPrice')::numeric,
      p_actor_id,
      p_actor_id,
      jsonb_build_object('import_run_id', import_run_id, 'source', item_row->'source')
    )
    on conflict (contract_id, line_number) do update
      set ls_code = excluded.ls_code,
          name = excluded.name,
          quantity = excluded.quantity,
          unit = excluded.unit,
          unit_price = excluded.unit_price,
          updated_by = p_actor_id,
          source_metadata = excluded.source_metadata;
  end loop;

  for inventory_row in
    select value from jsonb_array_elements(coalesce(p_plan->'inventoryItems', '[]'::jsonb))
  loop
    select inventory.id into inventory_item_id_value
    from public.inventory_items inventory
    where upper(regexp_replace(inventory.ls_code, '[^a-zA-Z0-9]', '', 'g')) = inventory_row->>'lsCode'
    for update;

    if inventory_item_id_value is null then
      insert into public.inventory_items (
        ls_code, name, base_unit, default_unit_price,
        source_metadata, created_by, updated_by
      ) values (
        inventory_row->>'lsCode',
        inventory_row->>'name',
        inventory_row->>'unit',
        nullif(inventory_row->>'defaultUnitPrice', '')::numeric,
        jsonb_build_object('import_run_id', import_run_id, 'source', inventory_row->'source'),
        p_actor_id,
        p_actor_id
      ) returning id into inventory_item_id_value;
    end if;
  end loop;

  for alias_row in
    select value from jsonb_array_elements(coalesce(p_plan->'aliases', '[]'::jsonb))
  loop
    select inventory.id into inventory_item_id_value
    from public.inventory_items inventory
    where upper(regexp_replace(inventory.ls_code, '[^a-zA-Z0-9]', '', 'g')) = alias_row->>'lsCode';

    insert into public.inventory_item_aliases (
      inventory_item_id, alias_kind, alias_value, source,
      source_metadata, created_by
    ) values (
      inventory_item_id_value,
      alias_row->>'kind',
      alias_row->>'value',
      'legacy_import',
      jsonb_build_object('import_run_id', import_run_id, 'source', alias_row->'source'),
      p_actor_id
    ) on conflict (inventory_item_id, alias_kind, alias_value) do nothing;
  end loop;

  for allocation_row in
    select value from jsonb_array_elements(coalesce(p_plan->'legacyAllocations', '[]'::jsonb))
  loop
    select item.id into contract_item_id_value
    from public.contract_items item
    join public.contracts contract on contract.id = item.contract_id
    where lower(btrim(contract.contract_number)) = lower(btrim(allocation_row->>'contractNumber'))
      and upper(regexp_replace(item.ls_code, '[^a-zA-Z0-9]', '', 'g')) = allocation_row->>'lsCode'
    order by item.line_number
    limit 1
    for update of item;

    if contract_item_id_value is null then
      raise exception using errcode = '23503', message = 'legacy allocation has no matching contract item';
    end if;

    insert into public.contract_item_allocations (
      contract_item_id, allocation_kind, quantity, source_identity,
      source_metadata, note, created_by
    ) values (
      contract_item_id_value,
      'legacy_import',
      (allocation_row->>'quantity')::numeric,
      allocation_row->>'sourceIdentity',
      jsonb_build_object(
        'import_run_id', import_run_id,
        'sequence', (allocation_row->>'sequence')::integer,
        'source', allocation_row->'source'
      ),
      'ยอดจัดซื้อเดิมจาก Google Sheets',
      p_actor_id
    ) on conflict (source_identity) where allocation_kind = 'legacy_import' do nothing;
  end loop;

  return import_run_id;
end
$function$;

revoke execute on function public.apply_lab_stock_import(jsonb, jsonb, text, uuid) from public;
revoke execute on function public.apply_lab_stock_import(jsonb, jsonb, text, uuid) from anon;
revoke execute on function public.apply_lab_stock_import(jsonb, jsonb, text, uuid) from authenticated;
grant execute on function public.apply_lab_stock_import(jsonb, jsonb, text, uuid) to service_role;

create or replace function public.apply_lab_stock_opening_counts(
  p_plan jsonb,
  p_report_hash text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  batch_id uuid;
  count_row jsonb;
  inventory_item_id_value uuid;
  inventory_lot_id_value uuid;
  count_date_value date;
begin
  perform public.assert_lab_stock_admin_actor(p_actor_id);

  if p_plan is null or p_plan->>'version' <> '1' then
    raise exception using errcode = '22023', message = 'unsupported opening count plan version';
  end if;
  if p_report_hash is null or p_report_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid opening count report hash';
  end if;
  if p_plan->>'approverId' <> p_actor_id::text then
    raise exception using errcode = '42501', message = 'opening count approver must match actor';
  end if;

  select batch.id into batch_id
  from public.lab_stock_opening_count_batches batch
  where batch.report_hash = p_report_hash;
  if batch_id is not null then
    return batch_id;
  end if;

  count_date_value := (p_plan->>'countDate')::date;
  batch_id := gen_random_uuid();
  insert into public.lab_stock_opening_count_batches (
    id, report_hash, count_date, plan, approved_by
  ) values (
    batch_id, p_report_hash, count_date_value, p_plan, p_actor_id
  );

  for count_row in
    select value from jsonb_array_elements(coalesce(p_plan->'rows', '[]'::jsonb))
  loop
    select inventory.id into inventory_item_id_value
    from public.inventory_items inventory
    where upper(regexp_replace(inventory.ls_code, '[^a-zA-Z0-9]', '', 'g')) = count_row->>'lsCode'
    for update;
    if inventory_item_id_value is null then
      raise exception using errcode = '23503', message = 'opening count LS code does not exist';
    end if;

    if exists (
      select 1 from public.inventory_lots lot
      where lot.inventory_item_id = inventory_item_id_value
        and lot.lot_number = count_row->>'lotNumber'
    ) then
      raise exception using errcode = '23505', message = 'opening count lot already exists';
    end if;

    insert into public.inventory_lots (
      inventory_item_id, lot_number, expiry_date, received_date,
      original_quantity, storage_location, note, source_metadata,
      created_by, updated_by
    ) values (
      inventory_item_id_value,
      count_row->>'lotNumber',
      nullif(count_row->>'expiryDate', '')::date,
      count_date_value,
      (count_row->>'quantity')::numeric,
      nullif(btrim(count_row->>'storageLocation'), ''),
      'ยอดยกมาจากการตรวจนับจริง',
      jsonb_build_object('opening_count_batch_id', batch_id, 'source_line', count_row->'sourceLine'),
      p_actor_id,
      p_actor_id
    ) returning id into inventory_lot_id_value;

    insert into public.stock_movements (
      inventory_item_id, inventory_lot_id, movement_type, quantity,
      occurred_on, source_document_type, source_document_id,
      note, source_metadata, created_by
    ) values (
      inventory_item_id_value,
      inventory_lot_id_value,
      'opening_adjustment',
      (count_row->>'quantity')::numeric,
      count_date_value,
      'opening_count',
      batch_id,
      'ยอดเปิดคลังจากการตรวจนับจริง',
      jsonb_build_object('opening_count_batch_id', batch_id, 'source_line', count_row->'sourceLine'),
      p_actor_id
    );
  end loop;

  return batch_id;
end
$function$;

revoke execute on function public.apply_lab_stock_opening_counts(jsonb, text, uuid) from public;
revoke execute on function public.apply_lab_stock_opening_counts(jsonb, text, uuid) from anon;
revoke execute on function public.apply_lab_stock_opening_counts(jsonb, text, uuid) from authenticated;
grant execute on function public.apply_lab_stock_opening_counts(jsonb, text, uuid) to service_role;

alter table public.lab_stock_import_runs enable row level security;
alter table public.lab_stock_opening_count_batches enable row level security;

revoke all on table public.lab_stock_import_runs from anon, authenticated;
revoke all on table public.lab_stock_opening_count_batches from anon, authenticated;
grant select on table public.lab_stock_import_runs to authenticated;
grant select on table public.lab_stock_opening_count_batches to authenticated;
grant select, insert, update, delete on table public.lab_stock_import_runs to service_role;
grant select, insert, update, delete on table public.lab_stock_opening_count_batches to service_role;

drop policy if exists lab_stock_import_runs_admin_read on public.lab_stock_import_runs;
create policy lab_stock_import_runs_admin_read
on public.lab_stock_import_runs for select
to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.ephis_id = '9495'
        or exists (
          select 1 from public.lab_stock_memberships membership
          where membership.profile_id = profile.id
            and membership.active
            and membership.role = 'admin'
        )
      )
  )
);

drop policy if exists lab_stock_opening_count_batches_admin_read on public.lab_stock_opening_count_batches;
create policy lab_stock_opening_count_batches_admin_read
on public.lab_stock_opening_count_batches for select
to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.ephis_id = '9495'
        or exists (
          select 1 from public.lab_stock_memberships membership
          where membership.profile_id = profile.id
            and membership.active
            and membership.role = 'admin'
        )
      )
  )
);

commit;
