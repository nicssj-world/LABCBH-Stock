-- Keep the public update_contract API, but preserve the explicit ceiling of an
-- equipment lease. The previous function derives every total from p_items;
-- leases intentionally have no items, so editing one wrote total = NULL.
begin;

alter function public.update_contract(bigint, uuid, jsonb, jsonb, timestamptz)
  rename to update_contract_without_total;

revoke execute on function public.update_contract_without_total(bigint, uuid, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_contract_without_total(bigint, uuid, jsonb, jsonb, timestamptz)
  to service_role;

create or replace function public.update_contract(
  p_contract_id bigint,
  p_actor_id uuid,
  p_contract jsonb,
  p_items jsonb,
  p_expected_updated_at timestamptz
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_contract public.contracts%rowtype;
  normalized_contract jsonb;
  parsed_contract_type text;
  parsed_total numeric(17,2);
begin
  if p_contract is null or jsonb_typeof(p_contract) <> 'object' then
    raise exception using errcode = '22023', message = 'contract payload must be an object';
  end if;

  parsed_contract_type := p_contract ->> 'contractType';

  if parsed_contract_type = 'equipment_lease' then
    if not (p_contract ? 'total') then
      raise exception using errcode = '22023', message = 'contract total is required for an equipment lease';
    end if;

    if jsonb_typeof(p_contract -> 'total') is distinct from 'number' then
      raise exception using errcode = '22023', message = 'contract total must be numeric';
    end if;

    parsed_total := round((p_contract ->> 'total')::numeric, 2);
    if parsed_total <= 0 then
      raise exception using errcode = '22023', message = 'contract total must be greater than zero';
    end if;

    -- The legacy function validates and updates all common metadata/items.
    -- Remove total only because its allowlist predates lease ceilings.
    normalized_contract := p_contract - 'total';
  elsif p_contract ? 'total' then
    raise exception using errcode = '22023', message = 'total may only be set for an equipment lease contract';
  else
    normalized_contract := p_contract;
  end if;

  select *
  into updated_contract
  from public.update_contract_without_total(
    p_contract_id,
    p_actor_id,
    normalized_contract,
    p_items,
    p_expected_updated_at
  );

  if parsed_contract_type = 'equipment_lease' then
    update public.contracts
    set total = parsed_total
    where id = p_contract_id
    returning * into updated_contract;
  end if;

  return updated_contract;
end
$function$;

revoke execute on function public.update_contract(bigint, uuid, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_contract(bigint, uuid, jsonb, jsonb, timestamptz)
  to service_role;

commit;
