begin;

-- A manual early expiry is an exceptional, auditable state transition. The
-- application uses this RPC through its server-only service-role client.
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
    ),
    updated_by = p_actor_id
  where id = p_contract_id
  returning * into updated_contract;

  return updated_contract;
end
$function$;

-- Keep the existing authorization shared by writes and corrections. Expiry is
-- checked only inside the expense-insert function below, so old entries remain
-- correctable after a contract has ended.
create or replace function public.assert_contract_expense_actor(
  p_actor_id uuid,
  p_contract_id bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.contracts contract
    join public.profiles profile on profile.id = p_actor_id
    where contract.id = p_contract_id
      and profile.status = 'active'
      and profile.deleted_at is null
      and p_actor_id = any (coalesce(contract.responsible_user_ids, '{}'::uuid[]))
  ) then
    return;
  end if;

  perform public.assert_contract_editor_actor(p_actor_id);
end
$function$;

-- Expired contracts (including those whose end date has passed) must not take
-- new monthly expense entries, even if a stale page calls the Server Action.
create or replace function public.record_contract_expense(
  p_actor_id uuid,
  p_contract_id bigint,
  p_amount numeric,
  p_usage_month date,
  p_usage_date date default null,
  p_note text default null
)
returns public.contract_usage
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract public.contracts%rowtype;
  committed numeric(15,2);
  actor_name text;
  inserted public.contract_usage%rowtype;
begin
  perform public.assert_contract_expense_actor(p_actor_id, p_contract_id);

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '23514', message = 'จำนวนเงินต้องมากกว่า 0';
  end if;

  if p_usage_month is null then
    raise exception using errcode = '23502', message = 'กรุณาระบุเดือนที่ใช้จ่าย';
  end if;

  if date_trunc('month', p_usage_month)::date <> p_usage_month then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายต้องเป็นวันที่ 1 ของเดือน';
  end if;

  select contract.* into target_contract
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  if target_contract.status <> 'active'
     or (target_contract.end_date is not null and target_contract.end_date < current_date) then
    raise exception using errcode = '55000', message = 'contract is not active';
  end if;

  if target_contract.contract_type is distinct from 'equipment_lease' then
    raise exception using errcode = '23514', message = 'สัญญานี้ไม่ได้ตัดงบเป็นรายเดือน';
  end if;

  if target_contract.start_date is not null
     and p_usage_month < date_trunc('month', target_contract.start_date)::date then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายอยู่ก่อนวันเริ่มสัญญา';
  end if;

  if target_contract.end_date is not null
     and p_usage_month > date_trunc('month', target_contract.end_date)::date then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายอยู่หลังวันสิ้นสุดสัญญา';
  end if;

  select coalesce(sum(usage.amount), 0) into committed
  from public.contract_usage usage
  where usage.contract_id = p_contract_id;

  if target_contract.total is not null and committed + p_amount > target_contract.total then
    raise exception using
      errcode = '23514',
      message = format(
        'จำนวนเงินเกินมูลค่าคงเหลือ (คงเหลือ %s บาท)',
        to_char(target_contract.total - committed, 'FM999,999,999.00')
      );
  end if;

  select profile.name into actor_name from public.profiles profile where profile.id = p_actor_id;

  insert into public.contract_usage (
    contract_id, amount, note, recorded_by, recorded_by_id, usage_date, usage_month
  ) values (
    p_contract_id,
    p_amount,
    nullif(btrim(p_note), ''),
    actor_name,
    p_actor_id,
    coalesce(p_usage_date, current_date),
    p_usage_month
  )
  returning * into inserted;

  return inserted;
end
$function$;

revoke execute on function public.expire_contract(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.expire_contract(bigint, uuid, text) to service_role;

revoke execute on function public.assert_contract_expense_actor(uuid, bigint) from public, anon, authenticated;
grant execute on function public.assert_contract_expense_actor(uuid, bigint) to service_role;

revoke execute on function public.record_contract_expense(uuid, bigint, numeric, date, date, text) from public, anon, authenticated;
grant execute on function public.record_contract_expense(uuid, bigint, numeric, date, date, text) to service_role;

commit;
