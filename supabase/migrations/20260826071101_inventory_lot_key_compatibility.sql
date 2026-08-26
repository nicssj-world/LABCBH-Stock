begin;

-- Corrective compatibility migration for environments where the posting RPC
-- already references lot_number_key but the generated column was not applied.
-- Keep this migration schema-only: do not replace post_goods_receipt here,
-- because newer environments may already have the partial-receiving version.
do $check_existing_lot_collisions$
begin
  if exists (
    select 1
    from public.inventory_lots
    group by inventory_item_id, upper(btrim(lot_number))
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'inventory lot compatibility found existing duplicate lot labels; reconcile inventory_lots and stock_movements before applying this migration';
  end if;
end
$check_existing_lot_collisions$;

alter table public.inventory_lots
  add column if not exists lot_number_key text
  generated always as (upper(btrim(lot_number))) stored;

create unique index if not exists inventory_lots_item_lot_key
  on public.inventory_lots (inventory_item_id, lot_number_key);

commit;
