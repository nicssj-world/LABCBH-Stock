-- Archiving a contract (archive_contract) has never had a way back: once
-- is_archived is true, getContract()/listContracts() exclude the row from
-- every read path, and its contract_number keeps blocking reuse in
-- create_contract's uniqueness check. A contract archived by mistake (not a
-- true duplicate) was previously unrecoverable except by direct SQL. This
-- adds the missing inverse of archive_contract, mirrored structurally.
begin;

create or replace function public.restore_contract(
  p_contract_id bigint,
  p_actor_id uuid
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_contract public.contracts%rowtype;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  select contract.*
  into current_contract
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'contract not found';
  end if;

  if not coalesce(current_contract.is_archived, false) then
    raise exception using errcode = '55000', message = 'contract is not archived';
  end if;

  update public.contracts
  set
    is_archived = false,
    updated_by = p_actor_id
  where id = p_contract_id
  returning * into current_contract;

  return current_contract;
end
$function$;

revoke execute on function public.restore_contract(bigint, uuid) from public, anon, authenticated;
grant execute on function public.restore_contract(bigint, uuid) to service_role;

commit;
