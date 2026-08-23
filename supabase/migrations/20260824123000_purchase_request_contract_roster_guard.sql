-- Tighten contract-roster inheritance independently of the application UI.
-- The checklist RPC sets policy_version only after copying the roster, so this
-- trigger is the final fail-closed gate for both create and edit transactions.
begin;

create or replace function public.guard_purchase_request_contract_roster()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  contract_id_value bigint;
  contract_type_value text;
  expected_result_count integer;
begin
  if new.checklist_policy_version is null or new.purchase_method <> 'contract' then
    return new;
  end if;

  begin
    contract_id_value := nullif(new.method_details ->> 'contractId', '')::bigint;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid contract id for checklist roster';
  end;

  select contract.contract_type
  into contract_type_value
  from public.contracts contract
  where contract.id = contract_id_value;
  if not found then
    raise exception using errcode = '23503', message = 'contract for checklist roster not found';
  end if;

  expected_result_count := case
    when contract_type_value in ('e_bidding', 'equipment_lease') then 3
    else 0
  end;

  if (select count(*) from public.contract_committees committee where committee.contract_id = contract_id_value and committee.committee_kind = 'specification') <> 3
     or (select count(*) from public.contract_committees committee where committee.contract_id = contract_id_value and committee.committee_kind = 'inspection') <> 3
     or (select count(*) from public.contract_committees committee where committee.contract_id = contract_id_value and committee.committee_kind = 'result') <> expected_result_count then
    raise exception using errcode = '23514', message = 'contract committee roster is incomplete for its contract type';
  end if;

  if exists (
    select 1
    from public.contract_committees committee
    left join public.profiles profile on profile.id = committee.profile_id
    where committee.contract_id = contract_id_value
      and (
        profile.id is null
        or profile.status <> 'active'
        or profile.deleted_at is not null
        or nullif(btrim(coalesce(profile.name, '')), '') is null
      )
  ) then
    raise exception using errcode = '23514', message = 'contract committee roster contains an inactive profile';
  end if;

  return new;
end
$function$;

drop trigger if exists guard_purchase_request_contract_roster on public.purchase_requests;
create trigger guard_purchase_request_contract_roster
before update of checklist_policy_version on public.purchase_requests
for each row execute function public.guard_purchase_request_contract_roster();

revoke execute on function public.guard_purchase_request_contract_roster() from public, anon, authenticated;
grant execute on function public.guard_purchase_request_contract_roster() to service_role;

commit;
