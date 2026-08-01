-- Writes for budget mode. The over-budget check runs under a lock on the
-- contract row so two concurrent entries cannot both see the same remaining
-- balance and both pass, which is how the portal's handler-level check failed.
begin;

-- Editors may record against any contract. Anyone named on a contract may
-- record against that contract only: the people doing this day to day are
-- Medical Technologists who hold no editor role.
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

  -- This lock is the whole point: it serialises every expense on this contract.
  select contract.* into target_contract
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
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

create or replace function public.delete_contract_expense(
  p_actor_id uuid,
  p_usage_id bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract_id bigint;
begin
  select usage.contract_id into target_contract_id
  from public.contract_usage usage
  where usage.id = p_usage_id;

  if target_contract_id is null then
    raise exception using errcode = 'P0002', message = 'ไม่พบรายการค่าใช้จ่าย';
  end if;

  perform public.assert_contract_expense_actor(p_actor_id, target_contract_id);

  delete from public.contract_usage where id = p_usage_id;
end
$function$;

create or replace function public.set_contract_responsible_users(
  p_actor_id uuid,
  p_contract_id bigint,
  p_profile_ids uuid[],
  p_note text default null
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous uuid[];
  next_ids uuid[];
  updated public.contracts%rowtype;
  candidate uuid;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  next_ids := coalesce(p_profile_ids, '{}'::uuid[]);

  if exists (
    select 1 from unnest(next_ids) as wanted(id)
    left join public.profiles profile on profile.id = wanted.id
    where profile.id is null or profile.status <> 'active' or profile.deleted_at is not null
  ) then
    raise exception using errcode = '23503', message = 'มีผู้รับผิดชอบที่ไม่ใช่ผู้ใช้งานที่ใช้งานอยู่';
  end if;

  select contract.responsible_user_ids into previous
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  previous := coalesce(previous, '{}'::uuid[]);

  update public.contracts
  set responsible_user_ids = next_ids
  where id = p_contract_id
  returning * into updated;

  -- One audit row per person added and per person removed, so a grant that was
  -- given and later withdrawn is still visible after the fact.
  foreach candidate in array (select coalesce(array(select unnest(next_ids) except select unnest(previous)), '{}'::uuid[])) loop
    insert into public.contract_responsible_audit
      (contract_id, profile_id, actor_id, previous_assigned, next_assigned, note)
    values (p_contract_id, candidate, p_actor_id, false, true, nullif(btrim(p_note), ''));
  end loop;

  foreach candidate in array (select coalesce(array(select unnest(previous) except select unnest(next_ids)), '{}'::uuid[])) loop
    insert into public.contract_responsible_audit
      (contract_id, profile_id, actor_id, previous_assigned, next_assigned, note)
    values (p_contract_id, candidate, p_actor_id, true, false, nullif(btrim(p_note), ''));
  end loop;

  return updated;
end
$function$;

-- Attaching or detaching the contract document. Storage holds the object; this
-- is the row that decides whether the application can see it.
create or replace function public.set_contract_file(
  p_actor_id uuid,
  p_contract_id bigint,
  p_file_url text
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.contracts%rowtype;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  update public.contracts
  set file_url = nullif(btrim(p_file_url), '')
  where id = p_contract_id
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  return updated;
end
$function$;

revoke execute on function public.assert_contract_expense_actor(uuid, bigint) from public, anon, authenticated;
grant execute on function public.assert_contract_expense_actor(uuid, bigint) to service_role;

revoke execute on function public.record_contract_expense(uuid, bigint, numeric, date, date, text) from public, anon, authenticated;
grant execute on function public.record_contract_expense(uuid, bigint, numeric, date, date, text) to service_role;

revoke execute on function public.delete_contract_expense(uuid, bigint) from public, anon, authenticated;
grant execute on function public.delete_contract_expense(uuid, bigint) to service_role;

revoke execute on function public.set_contract_responsible_users(uuid, bigint, uuid[], text) from public, anon, authenticated;
grant execute on function public.set_contract_responsible_users(uuid, bigint, uuid[], text) to service_role;

revoke execute on function public.set_contract_file(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.set_contract_file(uuid, bigint, text) to service_role;

commit;
