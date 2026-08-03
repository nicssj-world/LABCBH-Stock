-- Inventory items could be created but never edited or taken out of use — the
-- only per-item write was the minimum-stock override RPC. Adds:
--   update_inventory_item: edits name/base_unit/responsible_department/
--     default_unit_price/note. ls_code is deliberately not editable here — it
--     is the identity key inventory_items_ls_code_normalized_key relies on,
--     and ensure_contract_item_inventory()/PR item matching key off it.
--   set_inventory_item_active: flips is_active. Not a real delete: contract
--     items, PR lines, receipts, and requisitions all reference
--     inventory_items with `on delete restrict`, so nothing that ever moved
--     could be hard-deleted anyway. No forced reason (unlike archive_contract)
--     — this is a plain, instantly reversible visibility toggle and the table
--     has no reason column to store one in.
begin;

create or replace function public.update_inventory_item(
  p_inventory_item_id uuid,
  p_actor_id uuid,
  p_name text,
  p_base_unit text,
  p_responsible_department text default null,
  p_default_unit_price numeric default null,
  p_note text default null
)
returns public.inventory_items
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.inventory_items;
begin
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception using errcode = '23514', message = 'inventory item requires a name';
  end if;

  if nullif(btrim(coalesce(p_base_unit, '')), '') is null then
    raise exception using errcode = '23514', message = 'inventory item requires a base unit';
  end if;

  if p_default_unit_price is not null and p_default_unit_price < 0 then
    raise exception using errcode = '23514', message = 'default unit price cannot be negative';
  end if;

  update public.inventory_items
  set
    name = btrim(p_name),
    base_unit = btrim(p_base_unit),
    responsible_department = nullif(btrim(coalesce(p_responsible_department, '')), ''),
    default_unit_price = p_default_unit_price,
    note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at = now(),
    updated_by = p_actor_id
  where id = p_inventory_item_id
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'inventory item not found';
  end if;

  return updated;
end
$function$;

create or replace function public.set_inventory_item_active(
  p_inventory_item_id uuid,
  p_actor_id uuid,
  p_is_active boolean
)
returns public.inventory_items
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.inventory_items;
begin
  if p_is_active is null then
    raise exception using errcode = '22004', message = 'is_active is required';
  end if;

  update public.inventory_items
  set
    is_active = p_is_active,
    updated_at = now(),
    updated_by = p_actor_id
  where id = p_inventory_item_id
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'inventory item not found';
  end if;

  return updated;
end
$function$;

revoke execute on function public.update_inventory_item(uuid, uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.update_inventory_item(uuid, uuid, text, text, text, numeric, text) to service_role;

revoke execute on function public.set_inventory_item_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_inventory_item_active(uuid, uuid, boolean) to service_role;

commit;
