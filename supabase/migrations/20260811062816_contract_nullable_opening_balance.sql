begin;

-- Older contract-form clients can still send an untouched optional opening
-- balance as JSON null. The strict create_contract guard quite correctly
-- accepts a number or an omitted field, but JSON null means the same thing as
-- "not supplied" for this input. Keep the strict implementation intact and
-- put a compatibility boundary in front of it so one stale browser cannot
-- turn a valid contract (including LS016008) into a Server Components error.
alter function public.create_contract(uuid, jsonb, jsonb, date, text)
  rename to create_contract_strict;

create or replace function public.create_contract(
  p_actor_id uuid,
  p_contract jsonb,
  p_items jsonb,
  p_effective_date date,
  p_contract_number text default null
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_items jsonb := p_items;
begin
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    select coalesce(
      jsonb_agg(
        case
          when jsonb_typeof(item) = 'object'
           and jsonb_typeof(item -> 'openingUsedQuantity') = 'null'
            then item - 'openingUsedQuantity'
          else item
        end
        order by item_order
      ),
      '[]'::jsonb
    )
    into normalized_items
    from jsonb_array_elements(p_items) with ordinality as payload(item, item_order);
  end if;

  return public.create_contract_strict(
    p_actor_id,
    p_contract,
    normalized_items,
    p_effective_date,
    p_contract_number
  );
end
$function$;

revoke execute on function public.create_contract(uuid, jsonb, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.create_contract(uuid, jsonb, jsonb, date, text) to service_role;

-- The renamed implementation remains an internal service-role boundary. The
-- compatibility wrapper above is the only public function name callers need.
revoke execute on function public.create_contract_strict(uuid, jsonb, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.create_contract_strict(uuid, jsonb, jsonb, date, text) to service_role;

commit;
