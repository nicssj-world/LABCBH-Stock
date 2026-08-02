-- Allow the catalog to be extended without coupling master-data creation to a
-- contract. The application calls this service-role-only function after its
-- role check, while the database keeps the canonical constraints and audit
-- columns in one transaction.
create or replace function public.create_inventory_item(
  p_ls_code text,
  p_name text,
  p_base_unit text,
  p_responsible_department text default null,
  p_default_unit_price numeric default null,
  p_minimum_stock_months numeric default 1.5,
  p_note text default null,
  p_actor_id uuid default null
)
returns public.inventory_items
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  inserted public.inventory_items;
begin
  if nullif(btrim(coalesce(p_ls_code, '')), '') is null then
    raise exception using errcode = '23514', message = 'inventory item requires an LS code';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception using errcode = '23514', message = 'inventory item requires a name';
  end if;

  if nullif(btrim(coalesce(p_base_unit, '')), '') is null then
    raise exception using errcode = '23514', message = 'inventory item requires a base unit';
  end if;

  if p_default_unit_price is not null and p_default_unit_price < 0 then
    raise exception using errcode = '23514', message = 'default unit price cannot be negative';
  end if;

  if p_minimum_stock_months is null or p_minimum_stock_months <= 0 then
    raise exception using errcode = '23514', message = 'minimum stock months must be greater than zero';
  end if;

  insert into public.inventory_items (
    ls_code,
    name,
    base_unit,
    responsible_department,
    default_unit_price,
    minimum_stock_months,
    minimum_stock_override,
    is_active,
    note,
    source_metadata,
    created_by,
    updated_by
  )
  values (
    btrim(p_ls_code),
    btrim(p_name),
    btrim(p_base_unit),
    nullif(btrim(coalesce(p_responsible_department, '')), ''),
    p_default_unit_price,
    p_minimum_stock_months,
    null,
    true,
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object('source', 'manual_catalog'),
    p_actor_id,
    p_actor_id
  )
  returning * into inserted;

  return inserted;
end
$function$;

revoke execute on function public.create_inventory_item(text, text, text, text, numeric, numeric, text, uuid) from public;
revoke execute on function public.create_inventory_item(text, text, text, text, numeric, numeric, text, uuid) from anon;
revoke execute on function public.create_inventory_item(text, text, text, text, numeric, numeric, text, uuid) from authenticated;
grant execute on function public.create_inventory_item(text, text, text, text, numeric, numeric, text, uuid) to service_role;

-- Contract lines describe the reagent master data as part of the contract
-- workflow. Keep that catalog row available for PR/receiving/requisition
-- pickers, but never create a stock movement here: stock starts at zero and is
-- increased only when a receipt (or an approved opening count) is posted.
create or replace function public.ensure_contract_item_inventory()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  contract_department text;
begin
  select contract.department
  into contract_department
  from public.contracts contract
  where contract.id = new.contract_id;

  insert into public.inventory_items (
    ls_code,
    name,
    base_unit,
    responsible_department,
    default_unit_price,
    minimum_stock_months,
    minimum_stock_override,
    is_active,
    note,
    source_metadata,
    created_by,
    updated_by
  )
  values (
    btrim(new.ls_code),
    btrim(new.name),
    btrim(new.unit),
    contract_department,
    new.unit_price,
    1.5,
    null,
    true,
    null,
    jsonb_build_object(
      'source', 'contract_item',
      'contract_id', new.contract_id,
      'contract_item_id', new.id
    ),
    new.created_by,
    new.updated_by
  )
  on conflict do nothing;

  return new;
end
$function$;

revoke execute on function public.ensure_contract_item_inventory() from public;
revoke execute on function public.ensure_contract_item_inventory() from anon;
revoke execute on function public.ensure_contract_item_inventory() from authenticated;

drop trigger if exists contract_items_ensure_inventory on public.contract_items;
create trigger contract_items_ensure_inventory
after insert or update of contract_id, ls_code, name, unit, unit_price
on public.contract_items
for each row execute function public.ensure_contract_item_inventory();

-- Backfill legacy contract lines once, without touching any existing catalog
-- row or creating a movement.
insert into public.inventory_items (
  ls_code,
  name,
  base_unit,
  responsible_department,
  default_unit_price,
  minimum_stock_months,
  minimum_stock_override,
  is_active,
  note,
  source_metadata,
  created_by,
  updated_by
)
select distinct on (upper(regexp_replace(item.ls_code, '[^a-zA-Z0-9]', '', 'g')))
  btrim(item.ls_code),
  btrim(item.name),
  btrim(item.unit),
  contract.department,
  item.unit_price,
  1.5,
  null,
  true,
  null,
  jsonb_build_object(
    'source', 'contract_item_backfill',
    'contract_id', item.contract_id,
    'contract_item_id', item.id
  ),
  item.created_by,
  item.updated_by
from public.contract_items item
join public.contracts contract on contract.id = item.contract_id
left join public.inventory_items existing
  on upper(regexp_replace(existing.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
     upper(regexp_replace(item.ls_code, '[^a-zA-Z0-9]', '', 'g'))
where existing.id is null
order by upper(regexp_replace(item.ls_code, '[^a-zA-Z0-9]', '', 'g')), item.id
on conflict do nothing;
