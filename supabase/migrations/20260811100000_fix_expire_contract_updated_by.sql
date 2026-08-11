begin;

-- public.contracts has updated_at, but it does not have updated_by. The
-- contracts_lab_stock_set_updated_at trigger keeps updated_at current for
-- this update, so expiry must not attempt to write a nonexistent column.
create or replace function public.expire_contract(
  p_contract_id bigint,
  p_actor_id uuid,
  p_reason text
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_contract public.contracts%rowtype;
  updated_contract public.contracts%rowtype;
  normalized_reason text;
begin
  perform public.assert_contract_editor_actor(p_actor_id);
  normalized_reason := nullif(btrim(p_reason), '');

  if normalized_reason is null then
    raise exception using errcode = '22023', message = 'expiry reason is required';
  end if;

  select * into current_contract
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'contract not found';
  end if;

  if current_contract.procurement_stage <> 'contract_started' then
    raise exception using errcode = '55000', message = 'contract has not started';
  end if;

  if current_contract.status <> 'active' then
    raise exception using errcode = '55000', message = 'contract is not active';
  end if;

  update public.contracts
  set
    status = 'expired',
    source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object(
      'contract_status_change', jsonb_build_object(
        'status', 'expired',
        'reason', normalized_reason,
        'changed_at', now(),
        'actor_id', p_actor_id
      )
    )
  where id = p_contract_id
  returning * into updated_contract;

  return updated_contract;
end
$function$;

revoke execute on function public.expire_contract(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.expire_contract(bigint, uuid, text) to service_role;

commit;
