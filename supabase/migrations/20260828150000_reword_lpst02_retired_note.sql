-- Use clearer wording for the retired duplicate's audit note.
-- The note is written from an ASCII-only UTF-8 hex literal to avoid client
-- console encoding issues.

begin;

do $migration$
declare
  v_item_count bigint;
begin
  select count(*)
  into v_item_count
  from public.inventory_items as item
  where item.ls_code = 'LPST02-RETIRED-20260828'
    and item.is_active = false;

  if v_item_count = 0 then
    raise notice 'retired LPST02 note reword skipped: target row was not found';
    return;
  end if;

  if v_item_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'retired LPST02 note reword stopped: expected one target row, found %s',
        v_item_count
      );
  end if;

  update public.inventory_items as item
  set note = convert_from(
    decode(
      'e0b89be0b8b4e0b894e0b983e0b88ae0b989e0b887e0b8b2e0b899e0b8a3e0b8b2e0b8a2e0b881e0b8b2e0b8a3e0b980e0b899e0b8b7e0b988e0b8ade0b887e0b888e0b8b2e0b881e0b8a1e0b8b5e0b881e0b8b2e0b8a3e0b981e0b881e0b989e0b984e0b882e0b8a3e0b8abe0b8b1e0b8aae0b888e0b8b2e0b881204c535054303220e0b980e0b89be0b987e0b899204c505354303220e0b980e0b8a1e0b8b7e0b988e0b8ad20323032362d30382d3238',
      'hex'
    ),
    'UTF8'
  )
  where item.ls_code = 'LPST02-RETIRED-20260828'
    and item.is_active = false;
end
$migration$;

commit;
