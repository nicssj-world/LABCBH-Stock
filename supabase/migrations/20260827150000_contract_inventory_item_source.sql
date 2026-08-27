-- Keep contract lines attached to the inventory master. A contract stores a
-- snapshot of its commercial terms, but the inventory item (and therefore its
-- current LS code) is the identity used by PRs, receipts, and stock ledgers.
begin;

alter table public.contract_items
  add column if not exists inventory_item_id uuid;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.contract_items'::regclass
      and conname = 'contract_items_inventory_item_id_fkey'
  ) then
    alter table public.contract_items
      add constraint contract_items_inventory_item_id_fkey
      foreign key (inventory_item_id)
      references public.inventory_items(id)
      on delete restrict;
  end if;
end
$constraints$;

create index if not exists contract_items_inventory_item_id_idx
  on public.contract_items (inventory_item_id)
  where inventory_item_id is not null;

-- New contract rows are linked before the legacy after-trigger creates the
-- catalogue row. On an update, an already-linked item wins when the submitted
-- contract code is stale; an existing different inventory code is accepted as
-- an intentional item replacement. This keeps inventory_items.ls_code
-- authoritative without preventing normal contract-line edits.
create or replace function public.link_contract_item_inventory()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  linked_inventory_id uuid;
  canonical_ls_code text;
  contract_department text;
begin
  if tg_op = 'UPDATE' and old.inventory_item_id is not null
     and (new.inventory_item_id is null or new.inventory_item_id = old.inventory_item_id) then
    select inventory.id, inventory.ls_code
    into linked_inventory_id, canonical_ls_code
    from public.inventory_items inventory
    where inventory.id = old.inventory_item_id;

    if linked_inventory_id is not null
       and upper(regexp_replace(new.ls_code, '[^a-zA-Z0-9]', '', 'g'))
           is distinct from upper(regexp_replace(canonical_ls_code, '[^a-zA-Z0-9]', '', 'g')) then
      select inventory.id, inventory.ls_code
      into linked_inventory_id, canonical_ls_code
      from public.inventory_items inventory
      where upper(regexp_replace(inventory.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
            upper(regexp_replace(new.ls_code, '[^a-zA-Z0-9]', '', 'g'));

      if linked_inventory_id is null then
        select old_inventory.id, old_inventory.ls_code
        into linked_inventory_id, canonical_ls_code
        from public.inventory_items old_inventory
        where old_inventory.id = old.inventory_item_id;
      end if;
    end if;
  elsif new.inventory_item_id is not null then
    select inventory.id, inventory.ls_code
    into linked_inventory_id, canonical_ls_code
    from public.inventory_items inventory
    where inventory.id = new.inventory_item_id;

    if linked_inventory_id is null then
      raise exception using
        errcode = '23503',
        message = 'contract item inventory item not found';
    end if;
  end if;

  -- INSERT ... ON CONFLICT used by the legacy importer reaches this trigger
  -- before PostgreSQL knows which conflict row will win. Reuse the existing
  -- line's item when its name/unit still identify the same product, avoiding a
  -- duplicate inventory row for a stale contract code.
  if linked_inventory_id is null and tg_op = 'INSERT' then
    select existing.inventory_item_id, inventory.ls_code
    into linked_inventory_id, canonical_ls_code
    from public.contract_items existing
    join public.inventory_items inventory on inventory.id = existing.inventory_item_id
    where existing.contract_id = new.contract_id
      and existing.line_number = new.line_number
      and lower(btrim(existing.name)) = lower(btrim(new.name))
      and lower(btrim(existing.unit)) = lower(btrim(new.unit))
    limit 1;
  end if;

  if linked_inventory_id is null then
    select inventory.id, inventory.ls_code
    into linked_inventory_id, canonical_ls_code
    from public.inventory_items inventory
    where upper(regexp_replace(inventory.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
          upper(regexp_replace(new.ls_code, '[^a-zA-Z0-9]', '', 'g'));
  end if;

  if linked_inventory_id is null then
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
        'source', 'contract_item_link',
        'contract_id', new.contract_id,
        'contract_item_id', new.id
      ),
      new.created_by,
      new.updated_by
    )
    on conflict do nothing;

    select inventory.id, inventory.ls_code
    into linked_inventory_id, canonical_ls_code
    from public.inventory_items inventory
    where upper(regexp_replace(inventory.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
          upper(regexp_replace(new.ls_code, '[^a-zA-Z0-9]', '', 'g'));
  end if;

  if linked_inventory_id is null then
    raise exception using
      errcode = '23503',
      message = 'contract item could not be linked to inventory';
  end if;

  new.inventory_item_id := linked_inventory_id;
  new.ls_code := canonical_ls_code;
  return new;
end
$function$;

revoke execute on function public.link_contract_item_inventory() from public, anon, authenticated;

drop trigger if exists contract_items_link_inventory on public.contract_items;
create trigger contract_items_link_inventory
before insert or update of inventory_item_id, ls_code
on public.contract_items
for each row execute function public.link_contract_item_inventory();

-- Direct/imported inventory-code changes must propagate to every contract line
-- that points at that item. Keep the previous display code as an alias so a
-- later legacy import can still be reconciled without creating a new item.
create or replace function public.sync_contract_item_codes_from_inventory()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.ls_code is distinct from old.ls_code then
    insert into public.inventory_item_aliases (
      inventory_item_id,
      alias_kind,
      alias_value,
      source,
      source_metadata,
      created_by
    ) values (
      new.id,
      'ls_code',
      btrim(old.ls_code),
      'labcbh_stock',
      jsonb_build_object('source', 'inventory_code_sync', 'changed_at', now()),
      new.updated_by
    ) on conflict (inventory_item_id, alias_kind, alias_value) do nothing;

    update public.contract_items contract_item
    set
      inventory_item_id = new.id,
      ls_code = btrim(new.ls_code),
      updated_at = now(),
      updated_by = coalesce(new.updated_by, contract_item.updated_by)
    where contract_item.inventory_item_id = new.id
      and contract_item.ls_code is distinct from new.ls_code;
  end if;

  return new;
end
$function$;

revoke execute on function public.sync_contract_item_codes_from_inventory() from public, anon, authenticated;

drop trigger if exists inventory_items_sync_contract_codes on public.inventory_items;
create trigger inventory_items_sync_contract_codes
after update of ls_code
on public.inventory_items
for each row execute function public.sync_contract_item_codes_from_inventory();

-- Relink existing rows in progressively weaker but deterministic order. The
-- exact code is preferred, then metadata/aliases, and finally a unique
-- name+unit match for the historical case where only the inventory code was
-- corrected. Ambiguous rows stay visible in the warning below for manual
-- reconciliation instead of being linked to an arbitrary item.
update public.contract_items contract_item
set inventory_item_id = inventory.id
from public.inventory_items inventory
where contract_item.inventory_item_id is null
  and upper(regexp_replace(contract_item.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
      upper(regexp_replace(inventory.ls_code, '[^a-zA-Z0-9]', '', 'g'));

with metadata_candidates as (
  select contract_item.id as contract_item_id, (array_agg(inventory.id order by inventory.id))[1] as inventory_item_id
  from public.contract_items contract_item
  join public.inventory_items inventory
    on inventory.source_metadata ->> 'contract_item_id' = contract_item.id::text
  where contract_item.inventory_item_id is null
  group by contract_item.id
  having count(distinct inventory.id) = 1
)
update public.contract_items contract_item
set inventory_item_id = candidates.inventory_item_id
from metadata_candidates candidates
where contract_item.id = candidates.contract_item_id;

with alias_candidates as (
  select contract_item.id as contract_item_id, (array_agg(inventory.id order by inventory.id))[1] as inventory_item_id
  from public.contract_items contract_item
  join public.inventory_item_aliases alias_row
    on alias_row.alias_kind = 'ls_code'
   and upper(regexp_replace(alias_row.alias_value, '[^a-zA-Z0-9]', '', 'g')) =
       upper(regexp_replace(contract_item.ls_code, '[^a-zA-Z0-9]', '', 'g'))
  join public.inventory_items inventory on inventory.id = alias_row.inventory_item_id
  where contract_item.inventory_item_id is null
  group by contract_item.id
  having count(distinct inventory.id) = 1
)
update public.contract_items contract_item
set inventory_item_id = candidates.inventory_item_id
from alias_candidates candidates
where contract_item.id = candidates.contract_item_id;

with name_unit_candidates as (
  select contract_item.id as contract_item_id, (array_agg(inventory.id order by inventory.id))[1] as inventory_item_id
  from public.contract_items contract_item
  join public.inventory_items inventory
    on lower(btrim(inventory.base_unit)) = lower(btrim(contract_item.unit))
   and (
     lower(btrim(inventory.name)) = lower(btrim(contract_item.name))
     or exists (
       select 1
       from public.inventory_item_aliases alias_row
       where alias_row.inventory_item_id = inventory.id
         and alias_row.alias_kind = 'name'
         and lower(btrim(alias_row.alias_value)) = lower(btrim(contract_item.name))
     )
   )
  where contract_item.inventory_item_id is null
  group by contract_item.id
  having count(distinct inventory.id) = 1
)
update public.contract_items contract_item
set inventory_item_id = candidates.inventory_item_id
from name_unit_candidates candidates
where contract_item.id = candidates.contract_item_id;

-- The inventory display code is canonical even for rows that were just
-- relinked. The BEFORE trigger also normalizes the value for audit consistency.
update public.contract_items contract_item
set ls_code = inventory.ls_code
from public.inventory_items inventory
where contract_item.inventory_item_id = inventory.id
  and contract_item.ls_code is distinct from inventory.ls_code;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.contract_items'::regclass
      and conname = 'contract_items_inventory_item_id_required'
  ) then
    -- NOT VALID preserves any genuinely ambiguous legacy rows while making
    -- the trigger-backed link mandatory for every future write.
    alter table public.contract_items
      add constraint contract_items_inventory_item_id_required
      check (inventory_item_id is not null)
      not valid;
  end if;
end
$constraints$;

do $diagnostic$
declare
  unresolved_count bigint;
begin
  select count(*)
  into unresolved_count
  from public.contract_items
  where inventory_item_id is null;

  if unresolved_count > 0 then
    raise warning 'contract inventory relink left % ambiguous legacy contract lines', unresolved_count;
  end if;
end
$diagnostic$;

commit;
