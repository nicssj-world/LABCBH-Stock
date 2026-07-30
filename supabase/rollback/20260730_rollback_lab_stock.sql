-- Rollback for the nine LABCBH Stock migrations.
--
-- Deliberately NOT in supabase/migrations: this must never be applied by
-- `supabase db push`. Run it by hand, inside the cutover window, only to undo a
-- failed forward migration.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/20260730_rollback_lab_stock.sql
--
-- It restores the portal-owned state captured from the production schema dump
-- of 2026-07-30 13:01:13 — including the two policies the forward migration
-- drops and never recreates, which is the part a plain "drop the new tables"
-- rollback would miss, leaving the portal readable by nobody.
--
-- This is a schema rollback, not a time machine. Rows created through LABCBH
-- Stock live in tables that only exist while the migration is applied, so
-- dropping them destroys that work. The guard below refuses to run when such
-- rows exist. To proceed anyway, having accepted the loss:
--
--   set labcbh.confirm_data_loss = 'yes';
--
-- The legacy contracts / contract_usage / profiles rows are never touched.

begin;

-- ── Guard: refuse to silently destroy work done in the new system ───────────
do $guard$
declare
  operational_rows bigint := 0;
  offending text[] := '{}';
  tbl text;
  n bigint;
begin
  foreach tbl in array array[
    'contract_items', 'contract_stage_history', 'contract_item_allocations',
    'purchase_requests', 'goods_receipts', 'requisitions',
    'inventory_items', 'inventory_lots', 'stock_movements'
  ] loop
    if to_regclass('public.' || tbl) is null then continue; end if;
    execute format('select count(*) from public.%I', tbl) into n;
    if n > 0 then
      operational_rows := operational_rows + n;
      offending := offending || format('%s=%s', tbl, n);
    end if;
  end loop;

  if operational_rows > 0
     and coalesce(current_setting('labcbh.confirm_data_loss', true), '') <> 'yes'
  then
    raise exception using
      errcode = '55000',
      message = format(
        'refusing to roll back: %s row(s) created in LABCBH Stock would be destroyed (%s)',
        operational_rows, array_to_string(offending, ', ')
      ),
      hint = 'set labcbh.confirm_data_loss = ''yes''; to proceed after accepting the loss';
  end if;
end
$guard$;

-- ── Views ───────────────────────────────────────────────────────────────────
drop view if exists public.inventory_item_monthly_issues;
drop view if exists public.inventory_lot_balances;
drop view if exists public.inventory_item_balances;

-- ── Tables ──────────────────────────────────────────────────────────────────
-- Every foreign key among these points inward or at public.profiles, so cascade
-- cannot reach a portal-owned table. Asserted after the fact below.
drop table if exists public.lab_stock_opening_count_batches cascade;
drop table if exists public.lab_stock_import_runs cascade;
drop table if exists public.lab_stock_membership_audit cascade;
drop table if exists public.requisition_lot_allocations cascade;
drop table if exists public.requisition_items cascade;
drop table if exists public.requisitions cascade;
drop table if exists public.goods_receipt_items cascade;
drop table if exists public.goods_receipts cascade;
drop table if exists public.purchase_request_items cascade;
drop table if exists public.purchase_requests cascade;
drop table if exists public.inventory_minimum_stock_audit cascade;
drop table if exists public.stock_movements cascade;
drop table if exists public.inventory_lots cascade;
drop table if exists public.inventory_item_aliases cascade;
drop table if exists public.inventory_items cascade;
drop table if exists public.contract_item_allocations cascade;
drop table if exists public.contract_stage_history cascade;
drop table if exists public.contract_items cascade;
drop table if exists public.lab_stock_memberships cascade;

-- ── Functions ───────────────────────────────────────────────────────────────
-- Dropped by name so overloads are caught without hardcoding signatures.
do $functions$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'advance_contract_stage', 'apply_lab_stock_import',
        'apply_lab_stock_opening_counts', 'archive_contract',
        'assert_contract_editor_actor', 'assert_lab_stock_admin_actor',
        'assert_stock_officer_actor', 'confirm_purchase_request',
        'create_contract', 'create_goods_receipt', 'create_purchase_request',
        'create_requisition', 'fulfill_requisition',
        'guard_contract_item_quantity', 'guard_stock_movement_balance',
        'is_current_lab_stock_admin', 'lab_stock_set_updated_at',
        'post_goods_receipt', 'prevent_append_only_mutation',
        'record_stock_adjustment', 'reverse_purchase_request',
        'set_goods_receipt_image', 'set_inventory_minimum_stock',
        'set_lab_stock_membership', 'set_purchase_order_number',
        'update_contract', 'validate_contract_item_allocation'
      ])
  loop
    execute format('drop function if exists %s cascade', fn.sig);
  end loop;
end
$functions$;

-- ── public.contracts: back to the portal's shape ────────────────────────────
drop trigger if exists contracts_lab_stock_set_updated_at on public.contracts;

drop index if exists public.contracts_contract_number_normalized_key;
drop index if exists public.contracts_lab_stock_dashboard_idx;
drop index if exists public.contracts_contract_type_idx;
drop index if exists public.contracts_archived_by_idx;

alter table public.contracts
  drop constraint if exists contracts_fiscal_year_check,
  drop constraint if exists contracts_contract_type_check,
  drop constraint if exists contracts_procurement_stage_check,
  drop constraint if exists contracts_date_order_check,
  drop constraint if exists contracts_stage_number_check,
  drop constraint if exists contracts_lifecycle_status_date_check;

alter table public.contracts
  drop column if exists fiscal_year,
  drop column if exists contract_type,
  drop column if exists procurement_stage,
  drop column if exists display_name,
  drop column if exists is_archived,
  drop column if exists updated_at,
  drop column if exists portal_updated_at,
  drop column if exists sent_to_procurement_date,
  drop column if exists plan_published_date,
  drop column if exists tender_announced_date,
  drop column if exists result_consideration_date,
  drop column if exists winner_announced_date,
  drop column if exists contract_started_date,
  drop column if exists stage_updated_at,
  drop column if exists archived_at,
  drop column if exists archived_by,
  drop column if exists archive_reason,
  drop column if exists source_metadata;

-- The forward migration relaxed this so the stock system could stage a contract
-- before a vendor was known. Restoring it fails loudly if such a row survives,
-- which is the correct outcome: the portal schema cannot represent it.
do $vendor$
declare
  nulls bigint;
begin
  select count(*) into nulls from public.contracts where vendor is null;
  if nulls > 0 then
    raise exception using
      errcode = '23502',
      message = format('%s contract(s) have a null vendor and cannot be represented by the portal schema', nulls),
      hint = 'give each row a vendor, or delete the stock-created rows, then re-run';
  end if;
end
$vendor$;

alter table public.contracts alter column vendor set not null;

-- ── Policies and grants, verbatim from the pre-cutover production dump ──────
drop policy if exists contracts_lab_stock_app_read on public.contracts;

drop policy if exists contracts_auth_read on public.contracts;
create policy "contracts_auth_read" on public.contracts
  for select using ((auth.role() <> 'anon'::text));

drop policy if exists contracts_staff_write on public.contracts;
create policy "contracts_staff_write" on public.contracts
  using ((public.get_my_role() = any (array['staff'::text, 'admin'::text])));

grant all on table public.contracts to anon;
grant all on table public.contracts to authenticated;
grant all on table public.contracts to service_role;

-- ── Storage ─────────────────────────────────────────────────────────────────
drop policy if exists lab_stock_po_officer_insert on storage.objects;
drop policy if exists lab_stock_po_app_select on storage.objects;
drop policy if exists lab_stock_po_officer_update on storage.objects;
-- The bucket is left in place: deleting it would orphan any uploaded PO scans.
-- It is private and unreferenced once the policies above are gone.

-- ── Assert the portal survived ──────────────────────────────────────────────
do $verify$
begin
  if to_regclass('public.contracts') is null
     or to_regclass('public.contract_usage') is null
     or to_regclass('public.profiles') is null then
    raise exception 'rollback destroyed a portal-owned table; transaction aborted';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'contracts'
      and policyname = 'contracts_staff_write'
  ) then
    raise exception 'portal write policy was not restored; transaction aborted';
  end if;
end
$verify$;

commit;
