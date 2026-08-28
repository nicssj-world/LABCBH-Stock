-- Correct the production catalogue typo without moving any stock history.
--
-- The canonical row is the existing LSPT02 item.  Production also contains a
-- newer LPST02 row with no dependent records, so keep that row for audit but
-- retire it under a non-colliding code before correcting the canonical row.
-- Environments that do not contain both exact codes are intentionally a no-op.

begin;

do $migration$
declare
  v_old_count bigint;
  v_duplicate_count bigint;
  v_old_id uuid;
  v_duplicate_id uuid;
  v_old_name text;
  v_duplicate_name text;
  v_old_unit text;
  v_duplicate_unit text;
  v_duplicate_reference_count bigint;
  v_retired_code text := 'LPST02-RETIRED-20260828';
begin
  select count(*)
  into v_old_count
  from public.inventory_items as item
  where item.ls_code = 'LSPT02';

  select count(*)
  into v_duplicate_count
  from public.inventory_items as item
  where item.ls_code = 'LPST02';

  if v_old_count = 0 or v_duplicate_count = 0 then
    raise notice
      'inventory code correction skipped: both exact rows are required (LSPT02=%s, LPST02=%s)',
      v_old_count,
      v_duplicate_count;
    return;
  end if;

  if v_old_count <> 1 or v_duplicate_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'inventory code correction expected one LSPT02 and one LPST02 row; found %s and %s',
        v_old_count,
        v_duplicate_count
      );
  end if;

  select item.id, item.name, item.base_unit
  into v_old_id, v_old_name, v_old_unit
  from public.inventory_items as item
  where item.ls_code = 'LSPT02';

  select item.id, item.name, item.base_unit
  into v_duplicate_id, v_duplicate_name, v_duplicate_unit
  from public.inventory_items as item
  where item.ls_code = 'LPST02';

  -- Lock both catalogue rows in deterministic UUID order before checking or
  -- changing either row. This prevents a concurrent catalogue write from
  -- invalidating the preflight assumptions.
  perform 1
  from public.inventory_items as item
  where item.id in (v_old_id, v_duplicate_id)
  order by item.id
  for update;

  if lower(btrim(v_old_name)) <> lower(btrim(v_duplicate_name))
     or lower(btrim(v_old_unit)) <> lower(btrim(v_duplicate_unit)) then
    raise exception using
      errcode = 'P0001',
      message = 'inventory code correction stopped: the two rows do not have the same name and unit';
  end if;

  if exists (
    select 1
    from public.inventory_items as item
    where upper(regexp_replace(item.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
          upper(regexp_replace(v_retired_code, '[^a-zA-Z0-9]', '', 'g'))
  ) then
    raise exception using
      errcode = '23505',
      message = 'inventory code correction stopped: retired code already exists';
  end if;

  select
    (select count(*) from public.inventory_item_aliases as alias_row where alias_row.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.inventory_lots as lot where lot.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.stock_movements as movement where movement.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.inventory_minimum_stock_audit as audit_row where audit_row.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.inventory_stock_checks as stock_check where stock_check.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.inventory_lot_stock_checks as lot_check where lot_check.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.goods_receipt_items as receipt_item where receipt_item.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.purchase_request_items as purchase_item where purchase_item.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.requisition_items as requisition_item where requisition_item.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.service_purchase_request_items as service_item where service_item.inventory_item_id = v_duplicate_id)
    + (select count(*) from public.contract_items as contract_item where contract_item.inventory_item_id = v_duplicate_id)
  into v_duplicate_reference_count;

  if v_duplicate_reference_count <> 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'inventory code correction stopped: LPST02 row has %s dependent records',
        v_duplicate_reference_count
      );
  end if;

  -- Keep the duplicate row as an auditable inactive record. Marking it inactive
  -- alone would not release the normalized unique key, hence the retired code.
  update public.inventory_items as item
  set
    ls_code = v_retired_code,
    is_active = false,
    note = concat_ws(
      ' | ',
      nullif(item.note, ''),
      'รายการซ้ำที่เกษียณระหว่างแก้รหัส LSPT02 เป็น LPST02 เมื่อ 2026-08-28'
    )
  where item.id = v_duplicate_id;

  -- Preserve the original UUID. The production AFTER trigger records LSPT02 as
  -- an alias and synchronizes any linked contract line(s).
  update public.inventory_items as item
  set ls_code = 'LPST02'
  where item.id = v_old_id;

  if not exists (
    select 1
    from public.inventory_items as item
    where item.id = v_old_id
      and item.ls_code = 'LPST02'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'inventory code correction stopped: canonical item was not updated';
  end if;

  if not exists (
    select 1
    from public.inventory_item_aliases as alias_row
    where alias_row.inventory_item_id = v_old_id
      and alias_row.alias_kind = 'ls_code'
      and alias_row.alias_value = 'LSPT02'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'inventory code correction stopped: old code alias was not recorded';
  end if;

  if exists (
    select 1
    from public.contract_items as contract_item
    where contract_item.inventory_item_id = v_old_id
      and contract_item.ls_code <> 'LPST02'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'inventory code correction stopped: linked contract code was not synchronized';
  end if;
end
$migration$;

commit;
