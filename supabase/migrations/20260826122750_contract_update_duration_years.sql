-- Let direct contract create/edit forms complete the duration that the
-- purchase-request workflow already stores. This migration is intentionally
-- additive and idempotent: it never recreates the annual-plan tables.
begin;

alter table public.contracts
  add column if not exists contract_duration_years integer;

alter table public.contracts
  drop constraint if exists contracts_contract_duration_years_check;

alter table public.contracts
  add constraint contracts_contract_duration_years_check
  check (contract_duration_years is null or contract_duration_years in (1, 3));

create index if not exists contracts_contract_duration_years_idx
  on public.contracts (contract_duration_years)
  where contract_duration_years is not null;

-- Keep the existing strict create implementation unchanged. The public
-- compatibility wrapper removes the new field before the old allowlist sees
-- it, then writes the validated value to the newly-added column.
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
  created_contract public.contracts%rowtype;
  normalized_contract jsonb;
  normalized_items jsonb := p_items;
  parsed_duration integer;
begin
  if p_contract ? 'contractDurationYears' then
    if jsonb_typeof(p_contract -> 'contractDurationYears') is distinct from 'number'
       or p_contract ->> 'contractDurationYears' not in ('1', '3') then
      raise exception using
        errcode = '22023',
        message = 'contract duration must be 1 or 3 years';
    end if;
    parsed_duration := (p_contract ->> 'contractDurationYears')::integer;
    normalized_contract := p_contract - 'contractDurationYears';
  else
    normalized_contract := p_contract;
  end if;

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

  select *
  into created_contract
  from public.create_contract_strict(
    p_actor_id,
    normalized_contract,
    normalized_items,
    p_effective_date,
    p_contract_number
  );

  if parsed_duration is not null then
    update public.contracts
    set contract_duration_years = parsed_duration
    where id = created_contract.id
    returning * into created_contract;
  end if;

  return created_contract;
end
$function$;

revoke execute on function public.create_contract(uuid, jsonb, jsonb, date, text)
  from public, anon, authenticated;
grant execute on function public.create_contract(uuid, jsonb, jsonb, date, text)
  to service_role;

-- update_contract_without_total owns the common metadata/item allowlist. This
-- wrapper strips duration before delegating, then writes it in the same RPC
-- transaction. Omitting the field keeps older callers backward compatible.
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
  target_contract public.contracts%rowtype;
  updated_contract public.contracts%rowtype;
  normalized_contract jsonb;
  parsed_contract_type text;
  parsed_total numeric(17,2);
  parsed_duration integer;
  clears_total boolean := false;
begin
  if p_contract is null or jsonb_typeof(p_contract) <> 'object' then
    raise exception using errcode = '22023', message = 'contract payload must be an object';
  end if;

  if p_contract ? 'contractDurationYears' then
    if jsonb_typeof(p_contract -> 'contractDurationYears') is distinct from 'number'
       or p_contract ->> 'contractDurationYears' not in ('1', '3') then
      raise exception using
        errcode = '22023',
        message = 'contract duration must be 1 or 3 years';
    end if;
    parsed_duration := (p_contract ->> 'contractDurationYears')::integer;
  end if;

  parsed_contract_type := p_contract ->> 'contractType';

  if parsed_contract_type = 'equipment_lease' then
    if not (p_contract ? 'total') then
      raise exception using errcode = '22023', message = 'contract total is required for an equipment lease';
    end if;

    if jsonb_typeof(p_contract -> 'total') not in ('number', 'null') then
      raise exception using errcode = '22023', message = 'contract total must be numeric';
    end if;

    select contract.*
    into target_contract
    from public.contracts contract
    where contract.id = p_contract_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
    end if;

    if jsonb_typeof(p_contract -> 'total') = 'null' then
      clears_total := true;

      if target_contract.procurement_stage = 'contract_started' then
        raise exception using
          errcode = '23502',
          message = 'สัญญาเช่าเครื่องที่เริ่มแล้วต้องมีมูลค่าสัญญา';
      end if;
    else
      parsed_total := round((p_contract ->> 'total')::numeric, 2);
      if parsed_total <= 0 then
        raise exception using errcode = '22023', message = 'contract total must be greater than zero';
      end if;
    end if;

    -- The legacy function validates and updates all common metadata/items.
    -- Remove fields whose writes are handled by this wrapper.
    normalized_contract := p_contract - 'total' - 'contractDurationYears';
  elsif p_contract ? 'total' then
    raise exception using errcode = '22023', message = 'total may only be set for an equipment lease contract';
  else
    normalized_contract := p_contract - 'contractDurationYears';
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
    set total = case when clears_total then null else parsed_total end
    where id = p_contract_id
    returning * into updated_contract;
  end if;

  if parsed_duration is not null then
    update public.contracts
    set contract_duration_years = parsed_duration
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
