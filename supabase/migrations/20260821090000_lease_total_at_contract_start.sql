-- Move an equipment lease's ceiling from the purchase request that opens it to
-- the moment it actually starts.
--
-- A lease PR is written before procurement has run, so any figure entered then
-- is an estimate that negotiation can still move. The ceiling is only settled
-- when the contract is signed — the same moment the contract number becomes
-- known — so advance_contract_stage now collects both together.
--
-- This is a move, not a removal. contracts.total is what the over-budget guard
-- in record_contract_expense tests:
--
--     if target_contract.total is not null and committed + p_amount > ...
--
-- A started lease with a null ceiling therefore passes every expense silently.
-- Letting one reach contract_started would disable the only financial guard the
-- system has, so the requirement has to land here, under the same row lock as
-- the transition itself.
--
-- The wrapper approach mirrors 20260820130000_contract_lease_total.sql: the
-- long stage-transition body stays untouched and only the ceiling rule is added
-- around it.
begin;

alter function public.advance_contract_stage(bigint, uuid, text, date, text, text)
  rename to advance_contract_stage_without_total;

revoke execute on function public.advance_contract_stage_without_total(bigint, uuid, text, date, text, text)
  from public, anon, authenticated;
grant execute on function public.advance_contract_stage_without_total(bigint, uuid, text, date, text, text)
  to service_role;

create or replace function public.advance_contract_stage(
  p_contract_id bigint,
  p_actor_id uuid,
  p_to_stage text,
  p_effective_date date,
  p_contract_number text default null,
  p_total numeric default null,
  p_note text default null
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract public.contracts%rowtype;
  advanced_contract public.contracts%rowtype;
  parsed_total numeric(17,2);
  resolved_total numeric(17,2);
begin
  -- Taking the lock here, before the ceiling is checked, makes check-and-advance
  -- one atomic step. advance_contract_stage_without_total locks the same row
  -- inside this same transaction, which is a no-op re-entry, not a wait.
  select contract.*
  into target_contract
  from public.contracts contract
  where contract.id = p_contract_id
    and not coalesce(contract.is_archived, false)
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'active contract not found';
  end if;

  if p_total is not null then
    if p_to_stage is distinct from 'contract_started' then
      raise exception using errcode = '22023', message = 'contract total may only be set when starting a contract';
    end if;

    if target_contract.contract_type is distinct from 'equipment_lease' then
      raise exception using errcode = '22023', message = 'total may only be set for an equipment lease contract';
    end if;

    parsed_total := round(p_total, 2);

    if parsed_total <= 0 then
      raise exception using errcode = '22023', message = 'contract total must be greater than zero';
    end if;
  end if;

  -- An admin who created the contract through the direct "เพิ่มสัญญา" form has
  -- already recorded a ceiling; the one supplied now, if any, replaces it.
  if p_to_stage = 'contract_started' and target_contract.contract_type = 'equipment_lease' then
    resolved_total := coalesce(parsed_total, target_contract.total);

    -- Thai, unlike its English neighbours in this function: the client-side
    -- mirror in stageAdvanceSchema normally catches this first, but if the two
    -- ever drift it is a requester who reads the message.
    if resolved_total is null or resolved_total <= 0 then
      raise exception using
        errcode = '23502',
        message = 'ต้องระบุมูลค่าสัญญาเมื่อเริ่มสัญญาเช่าเครื่อง';
    end if;
  end if;

  select *
  into advanced_contract
  from public.advance_contract_stage_without_total(
    p_contract_id,
    p_actor_id,
    p_to_stage,
    p_effective_date,
    p_contract_number,
    p_note
  );

  if parsed_total is not null then
    update public.contracts
    set total = parsed_total
    where id = p_contract_id
    returning * into advanced_contract;
  end if;

  return advanced_contract;
end
$function$;

revoke execute on function public.advance_contract_stage(bigint, uuid, text, date, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.advance_contract_stage(bigint, uuid, text, date, text, numeric, text)
  to service_role;

-- update_contract has required a lease ceiling unconditionally since
-- 20260820130000. A lease opened from a purchase request now has none until it
-- starts, and that rule would leave such a contract uneditable for the whole of
-- procurement. Relax it to exactly the invariant that matters: a lease that has
-- already started must keep a ceiling, because that is when expenses can be
-- recorded against it.
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
  clears_total boolean := false;
begin
  if p_contract is null or jsonb_typeof(p_contract) <> 'object' then
    raise exception using errcode = '22023', message = 'contract payload must be an object';
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
    set total = case when clears_total then null else parsed_total end
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
