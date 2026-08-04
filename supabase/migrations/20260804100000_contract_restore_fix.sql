-- restore_contract (20260804090000) set updated_by on the update, but
-- public.contracts has no updated_by column (confirmed against the live
-- Staging schema: archive_contract, which it was meant to mirror, does not
-- set it either). Every restore attempt fails with 42703 "column \"updated_by\"
-- of relation \"contracts\" does not exist". Recreate without that column.
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
  set is_archived = false
  where id = p_contract_id
  returning * into current_contract;

  return current_contract;
end
$function$;

commit;
