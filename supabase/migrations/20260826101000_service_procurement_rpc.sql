-- งานจ้าง RPC and legacy Out Lab retirement.
begin;

create or replace function public.service_procurement_actor_has_role(
  p_actor_id uuid,
  p_role text
)
returns boolean
language sql
security invoker
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        (p_role = 'admin' and profile.ephis_id = '9495')
        or (p_role = 'head' and profile.role = 'Manager')
        or exists (
          select 1
          from public.lab_stock_memberships membership
          where membership.profile_id = profile.id
            and membership.active
            and membership.role = p_role
        )
      )
  );
$function$;
revoke execute on function public.service_procurement_actor_has_role(uuid, text) from public, anon, authenticated;
grant execute on function public.service_procurement_actor_has_role(uuid, text) to service_role;

create or replace function public.service_procurement_assert_actor(
  p_actor_id uuid,
  p_scope text,
  p_plan_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id and profile.status = 'active' and profile.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'service procurement actor is not active';
  end if;

  if p_scope = 'plan_admin'
    and not (public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or public.service_procurement_actor_has_role(p_actor_id, 'stock_officer')) then
    raise exception using errcode = '42501', message = 'only admin or stock officers may manage service plans';
  elsif p_scope = 'requester'
    and not (public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or public.service_procurement_actor_has_role(p_actor_id, 'head')) then
    raise exception using errcode = '42501', message = 'only admin or heads may create service purchase requests';
  elsif p_scope = 'stock'
    and not (public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or public.service_procurement_actor_has_role(p_actor_id, 'stock_officer')) then
    raise exception using errcode = '42501', message = 'only admin or stock officers may operate service POs';
  elsif p_scope = 'recorder'
    and not (
      public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or public.service_procurement_actor_has_role(p_actor_id, 'stock_officer')
      or exists (
        select 1 from public.service_plan_responsibles responsible
        where responsible.plan_id = p_plan_id and responsible.profile_id = p_actor_id
      )
    ) then
    raise exception using errcode = '42501', message = 'actor is not a service plan responsible';
  elsif p_scope = 'request_recorder'
    and not (
      public.service_procurement_actor_has_role(p_actor_id, 'admin')
      or public.service_procurement_actor_has_role(p_actor_id, 'stock_officer')
      or exists (
        select 1 from public.service_purchase_requests request
        where request.id = p_plan_id and request.requester_id = p_actor_id
      )
      or exists (
        select 1
        from public.service_purchase_requests request
        join public.service_plan_responsibles responsible on responsible.plan_id = request.plan_id
        where request.id = p_plan_id and responsible.profile_id = p_actor_id
      )
    ) then
    raise exception using errcode = '42501', message = 'actor is not allowed to record this service request';
  end if;
end
$function$;
revoke execute on function public.service_procurement_assert_actor(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.service_procurement_assert_actor(uuid, text, uuid) to service_role;

create or replace function public.service_procurement_fiscal_year(p_date date)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select extract(year from p_date)::integer
    + case when extract(month from p_date) >= 10 then 544 else 543 end;
$function$;
revoke execute on function public.service_procurement_fiscal_year(date) from public, anon, authenticated;
grant execute on function public.service_procurement_fiscal_year(date) to service_role;

create or replace function public.service_procurement_plan_balance(p_plan_id uuid)
returns table (
  budget numeric,
  spent numeric,
  reserved numeric,
  available numeric
)
language sql
security invoker
stable
set search_path = ''
as $function$
  select
    plan.budget,
    coalesce(sum(case
      when ledger.entry_kind in ('expense', 'historical_expense', 'expense_adjustment', 'expense_reversal')
        then ledger.amount else 0 end), 0)::numeric,
    coalesce(sum(case
      when ledger.entry_kind = 'reservation' then ledger.amount
      when ledger.entry_kind = 'reservation_release' then ledger.amount
      else 0 end), 0)::numeric,
    (plan.budget
      - coalesce(sum(case
          when ledger.entry_kind in ('expense', 'historical_expense', 'expense_adjustment', 'expense_reversal')
            then ledger.amount else 0 end), 0)
      - coalesce(sum(case
          when ledger.entry_kind = 'reservation' then ledger.amount
          when ledger.entry_kind = 'reservation_release' then ledger.amount
          else 0 end), 0))::numeric
  from public.service_procurement_plans plan
  left join public.service_plan_ledger ledger on ledger.plan_id = plan.id
  where plan.id = p_plan_id
  group by plan.id, plan.budget;
$function$;
revoke execute on function public.service_procurement_plan_balance(uuid) from public, anon, authenticated;
grant execute on function public.service_procurement_plan_balance(uuid) to service_role;

create or replace function public.create_service_procurement_plan(
  p_actor_id uuid,
  p_payload jsonb
)
returns public.service_procurement_plans
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_plan public.service_procurement_plans%rowtype;
  profile_id uuid;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'service plan payload must be an object';
  end if;

  insert into public.service_procurement_plans (
    fiscal_year, name, department, plan_type, budget, created_by, updated_by
  )
  values (
    (p_payload ->> 'fiscalYear')::integer,
    btrim(p_payload ->> 'name'),
    btrim(p_payload ->> 'department'),
    p_payload ->> 'type',
    (p_payload ->> 'budget')::numeric,
    p_actor_id,
    p_actor_id
  )
  returning * into created_plan;

  for profile_id in
    select value::uuid
    from jsonb_array_elements_text(coalesce(p_payload -> 'responsibleProfileIds', '[]'::jsonb)) value
  loop
    if not exists (
      select 1 from public.profiles profile
      where profile.id = profile_id and profile.status = 'active' and profile.deleted_at is null
    ) then
      raise exception using errcode = '23503', message = 'responsible profile is not active';
    end if;
    insert into public.service_plan_responsibles (plan_id, profile_id, assigned_by)
    values (created_plan.id, profile_id, p_actor_id);
    insert into public.service_plan_responsible_audit (plan_id, profile_id, action, actor_id)
    values (created_plan.id, profile_id, 'added', p_actor_id);
  end loop;

  return created_plan;
end
$function$;
revoke execute on function public.create_service_procurement_plan(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_service_procurement_plan(uuid, jsonb) to service_role;

create or replace function public.update_service_procurement_plan(
  p_actor_id uuid,
  p_plan_id uuid,
  p_payload jsonb
)
returns public.service_procurement_plans
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_plan public.service_procurement_plans%rowtype;
  updated_plan public.service_procurement_plans%rowtype;
  expected_updated_at timestamptz;
  current_id uuid;
  desired_id uuid;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  select * into current_plan from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;

  if (p_payload ->> 'fiscalYear')::integer <> current_plan.fiscal_year
    and (
      exists (select 1 from public.service_purchase_requests where plan_id = p_plan_id)
      or exists (select 1 from public.service_plan_ledger where plan_id = p_plan_id)
    ) then
    raise exception using errcode = '55000', message = 'cannot change the fiscal year of a referenced service plan';
  end if;

  expected_updated_at := nullif(p_payload ->> 'expectedUpdatedAt', '')::timestamptz;
  if expected_updated_at is not null and current_plan.updated_at is distinct from expected_updated_at then
    raise exception using errcode = '40001', message = 'service plan changed by another user';
  end if;

  update public.service_procurement_plans
  set fiscal_year = (p_payload ->> 'fiscalYear')::integer,
      name = btrim(p_payload ->> 'name'),
      department = btrim(p_payload ->> 'department'),
      plan_type = p_payload ->> 'type',
      updated_by = p_actor_id
  where id = p_plan_id
  returning * into updated_plan;
  foreach desired_id in array coalesce(
    array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload -> 'responsibleProfileIds', '[]'::jsonb)) value),
    '{}'::uuid[]
  ) loop
    if not exists (
      select 1 from public.profiles profile
      where profile.id = desired_id and profile.status = 'active' and profile.deleted_at is null
    ) then
      raise exception using errcode = '23503', message = 'responsible profile is not active';
    end if;
  end loop;
  for current_id in select profile_id from public.service_plan_responsibles where plan_id = p_plan_id loop
    if not exists (
      select 1 from jsonb_array_elements_text(coalesce(p_payload -> 'responsibleProfileIds', '[]'::jsonb)) value
      where value::uuid = current_id
    ) then
      delete from public.service_plan_responsibles where plan_id = p_plan_id and profile_id = current_id;
      insert into public.service_plan_responsible_audit (plan_id, profile_id, action, actor_id)
      values (p_plan_id, current_id, 'removed', p_actor_id);
    end if;
  end loop;
  foreach desired_id in array coalesce(
    array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload -> 'responsibleProfileIds', '[]'::jsonb)) value),
    '{}'::uuid[]
  ) loop
    if not exists (
      select 1 from public.service_plan_responsibles
      where plan_id = p_plan_id and profile_id = desired_id
    ) then
      insert into public.service_plan_responsibles (plan_id, profile_id, assigned_by)
      values (p_plan_id, desired_id, p_actor_id);
      insert into public.service_plan_responsible_audit (plan_id, profile_id, action, actor_id)
      values (p_plan_id, desired_id, 'added', p_actor_id);
    end if;
  end loop;
  return updated_plan;
end
$function$;
revoke execute on function public.update_service_procurement_plan(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_service_procurement_plan(uuid, uuid, jsonb) to service_role;

create or replace function public.set_service_plan_responsibles(
  p_actor_id uuid,
  p_plan_id uuid,
  p_profile_ids uuid[]
)
returns public.service_procurement_plans
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_id uuid;
  desired_id uuid;
  updated_plan public.service_procurement_plans%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  perform 1 from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;

  foreach desired_id in array coalesce(p_profile_ids, '{}'::uuid[]) loop
    if not exists (
      select 1 from public.profiles profile
      where profile.id = desired_id and profile.status = 'active' and profile.deleted_at is null
    ) then
      raise exception using errcode = '23503', message = 'responsible profile is not active';
    end if;
  end loop;

  for current_id in select profile_id from public.service_plan_responsibles where plan_id = p_plan_id loop
    if not (current_id = any(coalesce(p_profile_ids, '{}'::uuid[]))) then
      delete from public.service_plan_responsibles where plan_id = p_plan_id and profile_id = current_id;
      insert into public.service_plan_responsible_audit (plan_id, profile_id, action, actor_id)
      values (p_plan_id, current_id, 'removed', p_actor_id);
    end if;
  end loop;

  foreach desired_id in array coalesce(p_profile_ids, '{}'::uuid[]) loop
    if not exists (
      select 1 from public.service_plan_responsibles
      where plan_id = p_plan_id and profile_id = desired_id
    ) then
      insert into public.service_plan_responsibles (plan_id, profile_id, assigned_by)
      values (p_plan_id, desired_id, p_actor_id);
      insert into public.service_plan_responsible_audit (plan_id, profile_id, action, actor_id)
      values (p_plan_id, desired_id, 'added', p_actor_id);
    end if;
  end loop;

  select * into updated_plan from public.service_procurement_plans where id = p_plan_id;
  return updated_plan;
end
$function$;
revoke execute on function public.set_service_plan_responsibles(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_service_plan_responsibles(uuid, uuid, uuid[]) to service_role;

create or replace function public.revise_service_plan_budget(
  p_actor_id uuid,
  p_plan_id uuid,
  p_next_budget numeric,
  p_reason text
)
returns public.service_procurement_plans
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_plan public.service_procurement_plans%rowtype;
  balance record;
  updated_plan public.service_procurement_plans%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '23514', message = 'budget revision requires a reason';
  end if;
  select * into current_plan from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  select * into balance from public.service_procurement_plan_balance(p_plan_id);
  if p_next_budget < balance.spent + balance.reserved then
    raise exception using errcode = '23514', message = 'new budget is below spent and reserved amount';
  end if;
  update public.service_procurement_plans
  set budget = p_next_budget, updated_by = p_actor_id
  where id = p_plan_id
  returning * into updated_plan;
  insert into public.service_plan_budget_revisions (
    plan_id, previous_budget, next_budget, reason, actor_id
  ) values (
    p_plan_id, current_plan.budget, p_next_budget, btrim(p_reason), p_actor_id
  );
  return updated_plan;
end
$function$;
revoke execute on function public.revise_service_plan_budget(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.revise_service_plan_budget(uuid, uuid, numeric, text) to service_role;

create or replace function public.delete_service_procurement_plan(
  p_actor_id uuid,
  p_plan_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  has_request boolean;
  has_ledger boolean;
  has_budget_revision boolean;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'plan_admin');
  perform 1 from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  select exists(select 1 from public.service_purchase_requests where plan_id = p_plan_id) into has_request;
  select exists(select 1 from public.service_plan_ledger where plan_id = p_plan_id) into has_ledger;
  select exists(select 1 from public.service_plan_budget_revisions where plan_id = p_plan_id) into has_budget_revision;
  if has_request or has_ledger or has_budget_revision then
    raise exception using errcode = '55000', message = 'service plan cannot be deleted after it is referenced';
  end if;
  delete from public.service_procurement_plans where id = p_plan_id;
end
$function$;
revoke execute on function public.delete_service_procurement_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_service_procurement_plan(uuid, uuid) to service_role;

create or replace function public.record_service_plan_historical_expense(
  p_actor_id uuid,
  p_plan_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_reason text,
  p_source_reference text
)
returns public.service_plan_ledger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  plan_row public.service_procurement_plans%rowtype;
  balance record;
  entry public.service_plan_ledger%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'recorder', p_plan_id);
  if nullif(btrim(coalesce(p_reason, '')), '') is null
    or nullif(btrim(coalesce(p_source_reference, '')), '') is null then
    raise exception using errcode = '23514', message = 'historical expense requires a reason and source reference';
  end if;
  select * into plan_row from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  if date_trunc('month', p_expense_date)::date >= date_trunc('month', (timezone('Asia/Bangkok', now()))::date)::date then
    raise exception using errcode = '22023', message = 'historical expense must belong to a closed past month';
  end if;
  if public.service_procurement_fiscal_year(p_expense_date) <> plan_row.fiscal_year then
    raise exception using errcode = '22023', message = 'expense date must be inside the plan fiscal year';
  end if;
  select * into balance from public.service_procurement_plan_balance(p_plan_id);
  if p_amount > balance.available then
    raise exception using errcode = '23514', message = 'expense exceeds available plan budget';
  end if;
  insert into public.service_plan_ledger (
    plan_id, entry_kind, amount, event_date, reason, source_reference, actor_id
  ) values (
    p_plan_id, 'historical_expense', p_amount, p_expense_date, btrim(p_reason), btrim(p_source_reference), p_actor_id
  ) returning * into entry;
  return entry;
end
$function$;
revoke execute on function public.record_service_plan_historical_expense(uuid, uuid, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.record_service_plan_historical_expense(uuid, uuid, numeric, date, text, text) to service_role;

create or replace function public.adjust_service_plan_expense(
  p_actor_id uuid,
  p_plan_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_reason text,
  p_source_reference text,
  p_source_ledger_id uuid default null
)
returns public.service_plan_ledger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  plan_row public.service_procurement_plans%rowtype;
  balance record;
  entry public.service_plan_ledger%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'recorder', p_plan_id);
  if nullif(btrim(coalesce(p_reason, '')), '') is null
    or nullif(btrim(coalesce(p_source_reference, '')), '') is null then
    raise exception using errcode = '23514', message = 'expense adjustment requires a reason and source reference';
  end if;
  select * into plan_row from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  if public.service_procurement_fiscal_year(p_expense_date) <> plan_row.fiscal_year then
    raise exception using errcode = '22023', message = 'expense date must be inside the plan fiscal year';
  end if;
  if p_source_ledger_id is not null and not exists (
    select 1
    from public.service_plan_ledger
    where id = p_source_ledger_id
      and plan_id = p_plan_id
      and entry_kind in ('expense', 'historical_expense', 'expense_adjustment', 'expense_reversal')
  ) then
    raise exception using errcode = '23503', message = 'source ledger entry does not belong to this plan';
  end if;
  select * into balance from public.service_procurement_plan_balance(p_plan_id);
  if balance.spent + p_amount < 0 then
    raise exception using errcode = '23514', message = 'expense adjustment would make spent amount negative';
  end if;
  if p_amount > balance.available then
    raise exception using errcode = '23514', message = 'positive expense adjustment exceeds available budget';
  end if;
  insert into public.service_plan_ledger (
    plan_id, entry_kind, amount, event_date, reason, source_reference, reference_ledger_id, actor_id
  ) values (
    p_plan_id, 'expense_adjustment', p_amount, p_expense_date, btrim(p_reason), btrim(p_source_reference), p_source_ledger_id, p_actor_id
  ) returning * into entry;
  return entry;
end
$function$;
revoke execute on function public.adjust_service_plan_expense(uuid, uuid, numeric, date, text, text, uuid) from public, anon, authenticated;
grant execute on function public.adjust_service_plan_expense(uuid, uuid, numeric, date, text, text, uuid) to service_role;

create or replace function public.create_service_purchase_request(
  p_actor_id uuid,
  p_payload jsonb
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_profile public.profiles%rowtype;
  created_request public.service_purchase_requests%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  balance record;
  line jsonb;
  attachment jsonb;
  committee jsonb;
  item_index integer := 0;
  next_sequence integer;
  parsed_method text;
  parsed_fiscal_year integer;
  requested_amount numeric(17,2);
  line_total numeric(17,2);
  resolved_inventory_id uuid;
  manual_ls text;
  manual_name text;
  manual_unit text;
  quote_count integer;
  committee_seats integer;
  tor_count integer;
  selected_quotes integer;
  spec_count integer;
  inspection_count integer;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'requester');
  select * into actor_profile from public.profiles where id = p_actor_id;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'service purchase request payload must be an object';
  end if;
  parsed_method := p_payload ->> 'method';
  if parsed_method not in ('annual_items', 'laboratory_testing') then
    raise exception using errcode = '22023', message = 'invalid service purchase method';
  end if;
  parsed_fiscal_year := public.service_procurement_fiscal_year((p_payload ->> 'requestedDate')::date);
  perform pg_advisory_xact_lock(hashtext('labcbh_service_purchase_request_sequence'), parsed_fiscal_year);

  if nullif(btrim(coalesce(p_payload ->> 'department', '')), '') is null then
    raise exception using errcode = '22023', message = 'department is required';
  end if;

  if parsed_method = 'annual_items' then
    if jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) = 0 then
      raise exception using errcode = '22023', message = 'annual service request requires items';
    end if;
    if p_payload ->> 'requestedPoMonth' is not null then
      raise exception using errcode = '22023', message = 'annual service request does not accept a PO month';
    end if;
    select round(coalesce(sum((line ->> 'requestedQuantity')::numeric * (line ->> 'unitPrice')::numeric), 0), 2)
    into requested_amount
    from jsonb_array_elements(p_payload -> 'items') line;
    if requested_amount <= 0 then
      raise exception using errcode = '22023', message = 'annual service request amount must be positive';
    end if;
  else
    if jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) <> 0 then
      raise exception using errcode = '22023', message = 'laboratory service request cannot contain items';
    end if;
    if nullif(p_payload ->> 'requestedPoMonth', '') is null then
      raise exception using errcode = '22023', message = 'laboratory service request requires a PO month';
    end if;
    requested_amount := (p_payload ->> 'amount')::numeric;
    if requested_amount <= 0 then
      raise exception using errcode = '22023', message = 'laboratory service request amount must be positive';
    end if;
    if extract(day from (p_payload ->> 'requestedPoMonth')::date) <> 1
      or public.service_procurement_fiscal_year((p_payload ->> 'requestedPoMonth')::date) <> parsed_fiscal_year then
      raise exception using errcode = '22023', message = 'requested PO month must be inside the request fiscal year';
    end if;
  end if;

  if nullif(p_payload ->> 'planId', '') is not null then
    select * into plan_row
    from public.service_procurement_plans
    where id = (p_payload ->> 'planId')::uuid
    for update;
    if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
    if plan_row.fiscal_year <> parsed_fiscal_year then
      raise exception using errcode = '22023', message = 'request date must belong to the selected plan fiscal year';
    end if;
    select * into balance from public.service_procurement_plan_balance(plan_row.id);
    if requested_amount > balance.available then
      raise exception using errcode = '23514', message = format(
        'available service plan budget is %s but request needs %s', balance.available, requested_amount
      );
    end if;
  end if;

  select coalesce(max(request.sequence_number), 0) + 1
  into next_sequence
  from public.service_purchase_requests request
  where request.fiscal_year = parsed_fiscal_year;

  insert into public.service_purchase_requests (
    fiscal_year, sequence_number, document_number, requester_id, requester_name,
    department, requested_date, note, plan_id, purchase_method, requested_amount,
    requested_po_month, created_by, updated_by
  ) values (
    parsed_fiscal_year,
    next_sequence,
    'SPR-' || parsed_fiscal_year || '-' || lpad(next_sequence::text, 4, '0'),
    p_actor_id,
    coalesce(nullif(btrim(actor_profile.name), ''), p_actor_id::text),
    btrim(p_payload ->> 'department'),
    (p_payload ->> 'requestedDate')::date,
    nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'planId', '')), '')::uuid,
    parsed_method,
    requested_amount,
    nullif(btrim(coalesce(p_payload ->> 'requestedPoMonth', '')), '')::date,
    p_actor_id,
    p_actor_id
  ) returning * into created_request;

  for line in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    item_index := item_index + 1;
    resolved_inventory_id := nullif(btrim(coalesce(line ->> 'inventoryItemId', '')), '')::uuid;
    if resolved_inventory_id is null then
      manual_ls := nullif(btrim(coalesce(line ->> 'lsCode', '')), '');
      manual_name := nullif(btrim(coalesce(line ->> 'name', '')), '');
      manual_unit := nullif(btrim(coalesce(line ->> 'unit', '')), '');
      if manual_ls is null or manual_name is null or manual_unit is null then
        raise exception using errcode = '22023', message = 'manual service item requires LS, name and unit';
      end if;
      insert into public.inventory_items (
        ls_code, name, base_unit, responsible_department, default_unit_price,
        minimum_stock_months, is_active, source_metadata, created_by, updated_by
      ) values (
        manual_ls, manual_name, manual_unit, btrim(p_payload ->> 'department'),
        (line ->> 'unitPrice')::numeric, 1.5, true,
        jsonb_build_object('source', 'service_purchase_request', 'service_request_id', created_request.id),
        p_actor_id, p_actor_id
      ) on conflict do nothing;
      select item.id into resolved_inventory_id
      from public.inventory_items item
      where upper(regexp_replace(item.ls_code, '[^a-zA-Z0-9]', '', 'g')) =
        upper(regexp_replace(manual_ls, '[^a-zA-Z0-9]', '', 'g'))
        and item.is_active;
      if not found then raise exception using errcode = '23503', message = 'could not resolve service catalog item'; end if;
    elsif not exists (
      select 1 from public.inventory_items item where item.id = resolved_inventory_id and item.is_active
    ) then
      raise exception using errcode = '23503', message = 'service catalog item is inactive or missing';
    end if;

    select item.ls_code, item.name, item.base_unit
    into manual_ls, manual_name, manual_unit
    from public.inventory_items item where item.id = resolved_inventory_id;
    line_total := round((line ->> 'requestedQuantity')::numeric * (line ->> 'unitPrice')::numeric, 2);
    insert into public.service_purchase_request_items (
      purchase_request_id, line_number, inventory_item_id, ls_code, name, unit,
      requested_quantity, unit_price
    ) values (
      created_request.id, item_index, resolved_inventory_id, manual_ls, manual_name, manual_unit,
      (line ->> 'requestedQuantity')::numeric, (line ->> 'unitPrice')::numeric
    );
  end loop;

  quote_count := case when requested_amount >= 50000 then 3 else 1 end;
  committee_seats := case when requested_amount >= 100000 then 3 else 1 end;
  select count(*) into tor_count from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) entry where entry ->> 'kind' = 'tor';
  select count(*) into selected_quotes from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) entry where entry ->> 'kind' = 'quotation';
  if tor_count <> 1 or selected_quotes <> quote_count then
    raise exception using errcode = '23514', message = 'service PR checklist attachments are incomplete';
  end if;
  for attachment in select * from jsonb_array_elements(coalesce(p_payload -> 'attachments', '[]'::jsonb)) loop
    if attachment ->> 'storageKey' is null
      or attachment ->> 'storageKey' not like 'service-procurement/checklist/%'
      or attachment ->> 'storageKey' like '%..%'
      or (attachment ->> 'kind' = 'tor' and ((attachment ->> 'slot')::integer <> 1 or attachment ->> 'mimeType' <> 'application/pdf'))
      or (attachment ->> 'kind' = 'quotation' and ((attachment ->> 'slot')::integer < 1 or (attachment ->> 'slot')::integer > quote_count)) then
      raise exception using errcode = '22023', message = 'invalid service checklist attachment metadata';
    end if;
    insert into public.service_purchase_request_attachments (
      purchase_request_id, attachment_kind, slot, storage_key, file_name,
      mime_type, size_bytes, uploaded_by
    ) values (
      created_request.id, attachment ->> 'kind', (attachment ->> 'slot')::smallint,
      attachment ->> 'storageKey', attachment ->> 'fileName', attachment ->> 'mimeType',
      (attachment ->> 'sizeBytes')::bigint, p_actor_id
    );
  end loop;

  select count(*) into spec_count from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) entry where entry ->> 'kind' = 'specification';
  select count(*) into inspection_count from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) entry where entry ->> 'kind' = 'inspection';
  if spec_count <> committee_seats or inspection_count <> committee_seats then
    raise exception using errcode = '23514', message = 'service PR committee roster is incomplete';
  end if;
  for committee in select * from jsonb_array_elements(coalesce(p_payload -> 'committees', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.profiles profile
      where profile.id = (committee ->> 'profileId')::uuid
        and profile.status = 'active' and profile.deleted_at is null
    ) then
      raise exception using errcode = '23503', message = 'committee profile is inactive or missing';
    end if;
    insert into public.service_purchase_request_committees (
      purchase_request_id, committee_kind, seat, profile_id, name_snapshot, position_snapshot
    )
    select created_request.id, committee ->> 'kind', (committee ->> 'seat')::smallint,
      profile.id, coalesce(profile.name, profile.id::text), profile.role
    from public.profiles profile
    where profile.id = (committee ->> 'profileId')::uuid;
  end loop;

  if created_request.plan_id is not null then
    insert into public.service_plan_ledger (
      plan_id, entry_kind, amount, event_date, purchase_request_id,
      reason, source_reference, actor_id
    ) values (
      created_request.plan_id, 'reservation', requested_amount, created_request.requested_date,
      created_request.id, 'สำรองวงเงินเมื่อส่งใบ PR', created_request.document_number, p_actor_id
    );
  end if;
  return created_request;
end
$function$;
revoke execute on function public.create_service_purchase_request(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_service_purchase_request(uuid, jsonb) to service_role;

create or replace function public.confirm_service_purchase_request(
  p_actor_id uuid,
  p_request_id uuid
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'only pending service requests can be confirmed';
  end if;
  update public.service_purchase_requests
  set status = 'confirmed', confirmed_by = p_actor_id, confirmed_at = now(), updated_by = p_actor_id
  where id = p_request_id
  returning * into request_row;
  return request_row;
end
$function$;
revoke execute on function public.confirm_service_purchase_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_service_purchase_request(uuid, uuid) to service_role;

create or replace function public.set_service_purchase_request_ephis_number(
  p_actor_id uuid,
  p_request_id uuid,
  p_ephis_pr_number text
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_request public.service_purchase_requests%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if nullif(btrim(coalesce(p_ephis_pr_number, '')), '') is null then
    raise exception using errcode = '23514', message = 'E-Phis PR number is required';
  end if;
  update public.service_purchase_requests
  set ephis_pr_number = btrim(p_ephis_pr_number), updated_by = p_actor_id
  where id = p_request_id and status in ('confirmed', 'closed')
  returning * into updated_request;
  if not found then raise exception using errcode = '55000', message = 'service request is not confirmed'; end if;
  return updated_request;
end
$function$;
revoke execute on function public.set_service_purchase_request_ephis_number(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_service_purchase_request_ephis_number(uuid, uuid, text) to service_role;

create or replace function public.set_service_purchase_request_po_number(
  p_actor_id uuid,
  p_request_id uuid,
  p_po_number text
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_request public.service_purchase_requests%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if nullif(btrim(coalesce(p_po_number, '')), '') is null then
    raise exception using errcode = '23514', message = 'PO number is required';
  end if;
  update public.service_purchase_requests
  set po_number = btrim(p_po_number), po_status = case when po_status = 'not_issued' then 'open' else po_status end,
      updated_by = p_actor_id
  where id = p_request_id and status in ('confirmed', 'closed') and po_status <> 'cancelled'
  returning * into updated_request;
  if not found then raise exception using errcode = '55000', message = 'service request cannot record PO number'; end if;
  insert into public.service_purchase_request_po_events (purchase_request_id, event_kind, po_number, actor_id)
  values (updated_request.id, 'number_added', updated_request.po_number, p_actor_id);
  return updated_request;
end
$function$;
revoke execute on function public.set_service_purchase_request_po_number(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_service_purchase_request_po_number(uuid, uuid, text) to service_role;

create or replace function public.set_service_purchase_request_po_file(
  p_actor_id uuid,
  p_request_id uuid,
  p_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_checksum text
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_request public.service_purchase_requests%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if p_path is null or p_path not like 'service-procurement/%' or p_path like '%..%' then
    raise exception using errcode = '22023', message = 'invalid service PO file path';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or p_size_bytes < 1 or p_size_bytes > 10485760 then
    raise exception using errcode = '22023', message = 'invalid service PO file';
  end if;
  update public.service_purchase_requests
  set po_file_path = p_path, po_file_name = btrim(p_file_name), po_file_mime_type = p_mime_type,
      po_file_size_bytes = p_size_bytes, po_file_checksum = p_checksum,
      po_status = case when po_status = 'not_issued' then 'open' else po_status end,
      updated_by = p_actor_id
  where id = p_request_id and status in ('confirmed', 'closed') and po_status <> 'cancelled'
  returning * into updated_request;
  if not found then raise exception using errcode = '55000', message = 'service request cannot attach PO file'; end if;
  insert into public.service_purchase_request_po_events (purchase_request_id, event_kind, po_number, po_file_path, actor_id)
  values (updated_request.id, 'file_added', updated_request.po_number, updated_request.po_file_path, p_actor_id);
  return updated_request;
end
$function$;
revoke execute on function public.set_service_purchase_request_po_file(uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.set_service_purchase_request_po_file(uuid, uuid, text, text, text, bigint, text) to service_role;

create or replace function public.close_service_purchase_request_po(
  p_actor_id uuid,
  p_request_id uuid,
  p_reason text default null
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  plan_balance record;
  remaining_reservation numeric;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if request_row.po_status = 'closed' then
    return request_row;
  end if;
  if request_row.status not in ('confirmed', 'closed') or request_row.po_status = 'cancelled'
    or (request_row.po_number is null and request_row.po_file_path is null) then
    raise exception using errcode = '55000', message = 'service PO cannot be closed without PO number or file';
  end if;
  if request_row.plan_id is not null then
    perform 1 from public.service_procurement_plans where id = request_row.plan_id for update;
    select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
    into remaining_reservation
    from public.service_plan_ledger ledger
    where ledger.purchase_request_id = p_request_id;
    if remaining_reservation > 0 then
      insert into public.service_plan_ledger (
        plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id
      ) values (
        request_row.plan_id, 'reservation_release', -remaining_reservation, request_row.requested_date,
        p_request_id, coalesce(nullif(btrim(p_reason), ''), 'คืนวงเงินเมื่อปิด PO'), request_row.document_number, p_actor_id
      );
    end if;
  end if;
  update public.service_purchase_requests
  set status = 'closed', po_status = 'closed', closed_by = p_actor_id, closed_at = now(), updated_by = p_actor_id
  where id = p_request_id
  returning * into request_row;
  insert into public.service_purchase_request_po_events (purchase_request_id, event_kind, po_number, po_file_path, reason, actor_id)
  values (request_row.id, 'closed', request_row.po_number, request_row.po_file_path, nullif(btrim(coalesce(p_reason, '')), ''), p_actor_id);
  return request_row;
end
$function$;
revoke execute on function public.close_service_purchase_request_po(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.close_service_purchase_request_po(uuid, uuid, text) to service_role;

create or replace function public.cancel_service_purchase_request_po(
  p_actor_id uuid,
  p_request_id uuid,
  p_reason text
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  actual_amount numeric;
  remaining_reservation numeric;
  reversal_event public.service_purchase_request_usage_events%rowtype;
  source_event_id uuid;
  source_ledger_id uuid;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '23514', message = 'PO cancellation requires a reason';
  end if;
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if request_row.status = 'cancelled' then
    raise exception using errcode = '55000', message = 'service purchase request is already cancelled';
  end if;
  if request_row.plan_id is not null then
    perform 1 from public.service_procurement_plans where id = request_row.plan_id for update;
  end if;

  select coalesce(sum(event.amount), 0)
  into actual_amount
  from public.service_purchase_request_usage_events event
  where event.purchase_request_id = p_request_id
     and event.event_kind in ('annual_usage', 'lab_expense', 'expense_adjustment', 'expense_reversal');
  if actual_amount > 0 then
    select event.id
    into source_event_id
    from public.service_purchase_request_usage_events event
    where event.purchase_request_id = p_request_id
      and event.event_kind in ('annual_usage', 'lab_expense', 'expense_adjustment', 'expense_reversal')
    order by event.created_at desc
    limit 1;
    insert into public.service_purchase_request_usage_events (
      purchase_request_id, event_kind, expense_date, amount, note, reference_event_id, actor_id
    ) values (
      p_request_id, 'expense_reversal', (timezone('Asia/Bangkok', now()))::date,
      -actual_amount, btrim(p_reason), source_event_id, p_actor_id
    ) returning * into reversal_event;
    if request_row.plan_id is not null then
      select ledger.id
      into source_ledger_id
      from public.service_plan_ledger ledger
      where ledger.purchase_request_id = p_request_id
        and ledger.usage_event_id = source_event_id
        and ledger.entry_kind in ('expense', 'expense_adjustment', 'expense_reversal')
      order by ledger.created_at desc
      limit 1;
      insert into public.service_plan_ledger (
        plan_id, entry_kind, amount, event_date, purchase_request_id, usage_event_id,
        reason, source_reference, reference_ledger_id, actor_id
      ) values (
        request_row.plan_id, 'expense_reversal', -actual_amount, reversal_event.expense_date,
        p_request_id, reversal_event.id, btrim(p_reason), request_row.document_number, source_ledger_id, p_actor_id
      );
    end if;
  end if;
  if request_row.plan_id is not null then
    select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
    into remaining_reservation
    from public.service_plan_ledger ledger
    where ledger.purchase_request_id = p_request_id;
    if remaining_reservation > 0 then
      insert into public.service_plan_ledger (
        plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id
      ) values (
        request_row.plan_id, 'reservation_release', -remaining_reservation, request_row.requested_date,
        p_request_id, btrim(p_reason), request_row.document_number, p_actor_id
      );
    end if;
  end if;
  update public.service_purchase_requests
  set status = 'cancelled', po_status = 'cancelled', cancelled_by = p_actor_id,
      cancelled_at = now(), cancellation_reason = btrim(p_reason), updated_by = p_actor_id
  where id = p_request_id
  returning * into request_row;
  insert into public.service_purchase_request_po_events (purchase_request_id, event_kind, po_number, po_file_path, reason, actor_id)
  values (request_row.id, 'cancelled', request_row.po_number, request_row.po_file_path, btrim(p_reason), p_actor_id);
  return request_row;
end
$function$;
revoke execute on function public.cancel_service_purchase_request_po(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_service_purchase_request_po(uuid, uuid, text) to service_role;

create or replace function public.record_service_purchase_request_usage(
  p_actor_id uuid,
  p_request_id uuid,
  p_usage_date date,
  p_items jsonb,
  p_note text default null
)
returns public.service_purchase_request_usage_events
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  item_row public.service_purchase_request_items%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  line jsonb;
  usage_event public.service_purchase_request_usage_events%rowtype;
  total_amount numeric(17,2) := 0;
  line_quantity numeric(15,3);
  line_amount numeric(17,2);
  remaining_reservation numeric;
  all_complete boolean;
begin
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.purchase_method <> 'annual_items' or request_row.status <> 'confirmed' then
    raise exception using errcode = '55000', message = 'only confirmed annual-item service requests accept usage';
  end if;
  if request_row.po_number is null and request_row.po_file_path is null then
    raise exception using errcode = '55000', message = 'PO number or file is required before recording usage';
  end if;
  if public.service_procurement_fiscal_year(p_usage_date) <> request_row.fiscal_year then
    raise exception using errcode = '22023', message = 'usage date must be inside the request fiscal year';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'usage must contain at least one item';
  end if;

  if request_row.plan_id is not null then
    select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  end if;
  for line in select * from jsonb_array_elements(p_items) loop
    select * into item_row
    from public.service_purchase_request_items item
    where item.id = (line ->> 'itemId')::uuid and item.purchase_request_id = p_request_id
    for update;
    if not found then raise exception using errcode = '23503', message = 'usage item does not belong to service request'; end if;
    line_quantity := (line ->> 'quantity')::numeric;
    if line_quantity <= 0 or item_row.used_quantity + line_quantity > item_row.requested_quantity then
      raise exception using errcode = '23514', message = 'usage quantity exceeds requested quantity';
    end if;
    line_amount := round(line_quantity * item_row.unit_price, 2);
    total_amount := total_amount + line_amount;
  end loop;

  if request_row.plan_id is not null then
    select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
    into remaining_reservation
    from public.service_plan_ledger ledger
    where ledger.purchase_request_id = p_request_id;
    if total_amount > remaining_reservation then
      raise exception using errcode = '23514', message = 'usage exceeds this request reservation';
    end if;
  end if;

  insert into public.service_purchase_request_usage_events (
    purchase_request_id, event_kind, expense_date, amount, note, actor_id
  ) values (
    p_request_id, 'annual_usage', p_usage_date, total_amount,
    nullif(btrim(coalesce(p_note, '')), ''), p_actor_id
  ) returning * into usage_event;

  for line in select * from jsonb_array_elements(p_items) loop
    select * into item_row from public.service_purchase_request_items item
    where item.id = (line ->> 'itemId')::uuid and item.purchase_request_id = p_request_id;
    line_quantity := (line ->> 'quantity')::numeric;
    line_amount := round(line_quantity * item_row.unit_price, 2);
    insert into public.service_purchase_request_usage_items (
      usage_event_id, purchase_request_item_id, quantity, amount
    ) values (usage_event.id, item_row.id, line_quantity, line_amount);
    update public.service_purchase_request_items
    set used_quantity = used_quantity + line_quantity
    where id = item_row.id;
  end loop;

  if request_row.plan_id is not null then
    insert into public.service_plan_ledger (
      plan_id, entry_kind, amount, event_date, purchase_request_id, usage_event_id,
      reason, source_reference, actor_id
    ) values (
      request_row.plan_id, 'expense', total_amount, p_usage_date, p_request_id, usage_event.id,
      'บันทึกการใช้ในใบ PR งานจ้าง', request_row.document_number, p_actor_id
    );
    insert into public.service_plan_ledger (
      plan_id, entry_kind, amount, event_date, purchase_request_id,
      reason, source_reference, actor_id
    ) values (
      request_row.plan_id, 'reservation_release', -total_amount, p_usage_date, p_request_id,
      'เปลี่ยนยอดสำรองเป็นยอดใช้จริง', request_row.document_number, p_actor_id
    );
  end if;

  select not exists (
    select 1 from public.service_purchase_request_items item
    where item.purchase_request_id = p_request_id and item.used_quantity < item.requested_quantity
  ) into all_complete;
  if all_complete then
    if request_row.plan_id is not null then
      select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
      into remaining_reservation
      from public.service_plan_ledger ledger where ledger.purchase_request_id = p_request_id;
      if remaining_reservation > 0 then
        insert into public.service_plan_ledger (
          plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id
        ) values (
          request_row.plan_id, 'reservation_release', -remaining_reservation, p_usage_date,
          p_request_id, 'คืนยอดสำรองเมื่อรับครบ', request_row.document_number, p_actor_id
        );
      end if;
    end if;
    update public.service_purchase_requests
    set status = 'closed', po_status = 'closed', closed_by = p_actor_id, closed_at = now(), updated_by = p_actor_id
    where id = p_request_id;
    insert into public.service_purchase_request_po_events (
      purchase_request_id, event_kind, po_number, po_file_path, reason, actor_id
    ) values (
      p_request_id, 'closed', request_row.po_number, request_row.po_file_path,
      'ปิดอัตโนมัติเมื่อรับครบ', p_actor_id
    );
  end if;
  return usage_event;
end
$function$;
revoke execute on function public.record_service_purchase_request_usage(uuid, uuid, date, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_service_purchase_request_usage(uuid, uuid, date, jsonb, text) to service_role;

create or replace function public.record_service_purchase_request_lab_expense(
  p_actor_id uuid,
  p_request_id uuid,
  p_expense_date date,
  p_amount numeric,
  p_note text default null
)
returns public.service_purchase_request_usage_events
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  expense_event public.service_purchase_request_usage_events%rowtype;
  remaining_reservation numeric;
begin
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.purchase_method <> 'laboratory_testing' or request_row.status <> 'confirmed' then
    raise exception using errcode = '55000', message = 'only confirmed laboratory service requests accept expense';
  end if;
  if request_row.po_number is null then
    raise exception using errcode = '55000', message = 'PO number is required before recording expense';
  end if;
  if public.service_procurement_fiscal_year(p_expense_date) <> request_row.fiscal_year then
    raise exception using errcode = '22023', message = 'expense date must be inside the request fiscal year';
  end if;
  if p_amount <= 0 or p_amount > request_row.requested_amount then
    raise exception using errcode = '23514', message = 'actual laboratory expense exceeds PR ceiling';
  end if;
  if exists (
    select 1 from public.service_purchase_request_usage_events
    where purchase_request_id = p_request_id and event_kind = 'lab_expense'
  ) then
    raise exception using errcode = '55000', message = 'laboratory service request already has its primary expense';
  end if;
  if request_row.plan_id is not null then
    select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
    select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
    into remaining_reservation
    from public.service_plan_ledger ledger where ledger.purchase_request_id = p_request_id;
    if p_amount > remaining_reservation then
      raise exception using errcode = '23514', message = 'actual laboratory expense exceeds the reserved PR ceiling';
    end if;
  end if;

  insert into public.service_purchase_request_usage_events (
    purchase_request_id, event_kind, expense_date, amount, note, actor_id
  ) values (
    p_request_id, 'lab_expense', p_expense_date, p_amount,
    nullif(btrim(coalesce(p_note, '')), ''), p_actor_id
  ) returning * into expense_event;

  if request_row.plan_id is not null then
    insert into public.service_plan_ledger (
      plan_id, entry_kind, amount, event_date, purchase_request_id, usage_event_id,
      reason, source_reference, actor_id
    ) values (
      request_row.plan_id, 'expense', p_amount, p_expense_date, p_request_id, expense_event.id,
      'บันทึกค่าใช้จ่ายจริงของงานตรวจห้องปฏิบัติการ', request_row.document_number, p_actor_id
    );
    select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
    into remaining_reservation
    from public.service_plan_ledger ledger where ledger.purchase_request_id = p_request_id;
    if remaining_reservation > 0 then
      insert into public.service_plan_ledger (
        plan_id, entry_kind, amount, event_date, purchase_request_id,
        reason, source_reference, actor_id
      ) values (
        request_row.plan_id, 'reservation_release', -remaining_reservation, p_expense_date,
        p_request_id, 'คืนยอดสำรองเมื่อบันทึกค่าใช้จ่ายจริง', request_row.document_number, p_actor_id
      );
    end if;
  end if;
  update public.service_purchase_requests
  set status = 'closed', po_status = 'closed', closed_by = p_actor_id, closed_at = now(), updated_by = p_actor_id
  where id = p_request_id;
  insert into public.service_purchase_request_po_events (
    purchase_request_id, event_kind, po_number, po_file_path, reason, actor_id
  ) values (
    p_request_id, 'closed', request_row.po_number, request_row.po_file_path,
    'ปิดอัตโนมัติเมื่อบันทึกค่าใช้จ่ายจริง', p_actor_id
  );
  return expense_event;
end
$function$;
revoke execute on function public.record_service_purchase_request_lab_expense(uuid, uuid, date, numeric, text) from public, anon, authenticated;
grant execute on function public.record_service_purchase_request_lab_expense(uuid, uuid, date, numeric, text) to service_role;

create or replace function public.adjust_service_purchase_request_lab_expense(
  p_actor_id uuid,
  p_request_id uuid,
  p_source_event_id uuid,
  p_expense_date date,
  p_amount numeric,
  p_note text
)
returns public.service_purchase_request_usage_events
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  source_event public.service_purchase_request_usage_events%rowtype;
  adjustment_event public.service_purchase_request_usage_events%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  plan_balance record;
  current_actual numeric;
begin
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.purchase_method <> 'laboratory_testing' or request_row.status <> 'closed' then
    raise exception using errcode = '55000', message = 'only closed laboratory service requests accept adjustments';
  end if;
  if p_amount = 0 or nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception using errcode = '23514', message = 'adjustment amount and reason are required';
  end if;
  if public.service_procurement_fiscal_year(p_expense_date) <> request_row.fiscal_year then
    raise exception using errcode = '22023', message = 'adjustment date must be inside the request fiscal year';
  end if;
  select * into source_event
  from public.service_purchase_request_usage_events
  where id = p_source_event_id and purchase_request_id = p_request_id
    and event_kind in ('lab_expense', 'expense_adjustment')
  for update;
  if not found then raise exception using errcode = '23503', message = 'source laboratory expense was not found'; end if;
  select coalesce(sum(event.amount), 0)
  into current_actual
  from public.service_purchase_request_usage_events event
  where event.purchase_request_id = p_request_id
    and event.event_kind in ('lab_expense', 'expense_adjustment', 'expense_reversal');
  if current_actual + p_amount < 0 or current_actual + p_amount > request_row.requested_amount then
    raise exception using errcode = '23514', message = 'net laboratory expense must stay between zero and the PR ceiling';
  end if;
  if request_row.plan_id is not null then
    select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
    if p_amount > 0 then
      select * into plan_balance from public.service_procurement_plan_balance(request_row.plan_id);
      if p_amount > plan_balance.available then
        raise exception using errcode = '23514', message = 'positive laboratory adjustment exceeds available plan budget';
      end if;
    end if;
  end if;
  insert into public.service_purchase_request_usage_events (
    purchase_request_id, event_kind, expense_date, amount, note, reference_event_id, actor_id
  ) values (
    p_request_id, 'expense_adjustment', p_expense_date, p_amount, btrim(p_note), p_source_event_id, p_actor_id
  ) returning * into adjustment_event;
  if request_row.plan_id is not null then
    insert into public.service_plan_ledger (
      plan_id, entry_kind, amount, event_date, purchase_request_id, usage_event_id,
      reference_ledger_id, reason, source_reference, actor_id
    )
    select request_row.plan_id, 'expense_adjustment', p_amount, p_expense_date,
      p_request_id, adjustment_event.id, ledger.id, btrim(p_note), request_row.document_number, p_actor_id
    from public.service_plan_ledger ledger
    where ledger.usage_event_id = p_source_event_id and ledger.entry_kind in ('expense', 'expense_adjustment')
    limit 1;
    if not found then
      insert into public.service_plan_ledger (
        plan_id, entry_kind, amount, event_date, purchase_request_id, usage_event_id,
        reason, source_reference, actor_id
      ) values (
        request_row.plan_id, 'expense_adjustment', p_amount, p_expense_date, p_request_id,
        adjustment_event.id, btrim(p_note), request_row.document_number, p_actor_id
      );
    end if;
  end if;
  return adjustment_event;
end
$function$;
revoke execute on function public.adjust_service_purchase_request_lab_expense(uuid, uuid, uuid, date, numeric, text) from public, anon, authenticated;
grant execute on function public.adjust_service_purchase_request_lab_expense(uuid, uuid, uuid, date, numeric, text) to service_role;

create or replace function public.update_service_purchase_request_header(
  p_actor_id uuid,
  p_request_id uuid,
  p_department text,
  p_requested_date date,
  p_note text
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
begin
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if not (
    request_row.requester_id = p_actor_id
    or public.service_procurement_actor_has_role(p_actor_id, 'admin')
    or public.service_procurement_actor_has_role(p_actor_id, 'head')
  ) then
    raise exception using errcode = '42501', message = 'actor cannot edit this service purchase request';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'only pending service requests can be edited';
  end if;
  if public.service_procurement_fiscal_year(p_requested_date) <> request_row.fiscal_year then
    raise exception using errcode = '22023', message = 'requested date cannot move to another fiscal year after SPR numbering';
  end if;
  update public.service_purchase_requests
  set department = btrim(p_department), requested_date = p_requested_date,
      note = nullif(btrim(coalesce(p_note, '')), ''), updated_by = p_actor_id
  where id = p_request_id
  returning * into request_row;
  return request_row;
end
$function$;
revoke execute on function public.update_service_purchase_request_header(uuid, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.update_service_purchase_request_header(uuid, uuid, text, date, text) to service_role;

create or replace function public.cancel_service_purchase_request(
  p_actor_id uuid,
  p_request_id uuid,
  p_reason text
)
returns public.service_purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  remaining_reservation numeric;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '23514', message = 'cancellation requires a reason';
  end if;
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'only pending service requests can be cancelled directly';
  end if;
  if not (
    request_row.requester_id = p_actor_id
    or public.service_procurement_actor_has_role(p_actor_id, 'admin')
    or public.service_procurement_actor_has_role(p_actor_id, 'head')
  ) then
    raise exception using errcode = '42501', message = 'actor cannot cancel this service purchase request';
  end if;
  if request_row.plan_id is not null then
    perform 1 from public.service_procurement_plans where id = request_row.plan_id for update;
    select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
    into remaining_reservation
    from public.service_plan_ledger ledger where ledger.purchase_request_id = p_request_id;
    if remaining_reservation > 0 then
      insert into public.service_plan_ledger (
        plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id
      ) values (
        request_row.plan_id, 'reservation_release', -remaining_reservation, request_row.requested_date,
        p_request_id, btrim(p_reason), request_row.document_number, p_actor_id
      );
    end if;
  end if;
  update public.service_purchase_requests
  set status = 'cancelled', po_status = 'cancelled', cancelled_by = p_actor_id,
      cancelled_at = now(), cancellation_reason = btrim(p_reason), updated_by = p_actor_id
  where id = p_request_id
  returning * into request_row;
  return request_row;
end
$function$;
revoke execute on function public.cancel_service_purchase_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_service_purchase_request(uuid, uuid, text) to service_role;

create or replace function public.enqueue_service_purchase_request_notification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    insert into public.lab_stock_notifications (
      recipient_id, event_type, entity_type, entity_id, document_number, title, body, href
    )
    select distinct profile.id, 'service_purchase_request_created', 'service_purchase_request', new.id,
      new.document_number, 'มีใบ PR งานจ้างใหม่รอดำเนินการ',
      format('หน่วยงาน %s · ผู้ขอ %s', new.department, new.requester_name),
      '/service-procurement/purchase-requests/' || new.id::text
    from public.profiles profile
    left join public.lab_stock_memberships membership
      on membership.profile_id = profile.id and membership.active
    where profile.status = 'active' and profile.deleted_at is null
      and (profile.ephis_id = '9495' or membership.role in ('admin', 'stock_officer'))
    on conflict (recipient_id, event_type, entity_id) do nothing;
  elsif new.po_status = 'cancelled'
    and (tg_op = 'UPDATE' and old.po_status <> 'cancelled')
    and (old.po_number is not null or old.po_file_path is not null) then
    insert into public.lab_stock_notifications (
      recipient_id, event_type, entity_type, entity_id, document_number, title, body, href
    )
    select distinct profile.id, 'service_purchase_order_cancelled', 'service_purchase_request', new.id,
      new.document_number, 'มีการยกเลิก PO งานจ้าง',
      format('%s · เหตุผล: %s', new.document_number, coalesce(new.cancellation_reason, 'ไม่ระบุ')),
      '/service-procurement/purchase-requests/' || new.id::text
    from public.profiles profile
    left join public.lab_stock_memberships membership
      on membership.profile_id = profile.id and membership.active
    where profile.status = 'active' and profile.deleted_at is null
      and (profile.ephis_id = '9495' or membership.role in ('admin', 'stock_officer'))
    on conflict (recipient_id, event_type, entity_id) do nothing;
  end if;
  return new;
end
$function$;
revoke execute on function public.enqueue_service_purchase_request_notification() from public, anon, authenticated;
drop trigger if exists service_purchase_requests_enqueue_notification on public.service_purchase_requests;
create trigger service_purchase_requests_enqueue_notification
after insert or update of status, po_status on public.service_purchase_requests
for each row execute function public.enqueue_service_purchase_request_notification();

-- LINE sends are external side effects. Keep an immutable snapshot and a retry
-- key so a timeout can be retried without creating a duplicate message.
create table if not exists public.service_purchase_request_line_notifications (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  sent_by uuid not null references public.profiles(id) on delete restrict,
  status text not null check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  retry_key uuid not null unique default gen_random_uuid(),
  target_group_id text not null check (nullif(btrim(target_group_id), '') is not null),
  document_url text not null check (document_url like 'https://%'),
  document_number text not null check (nullif(btrim(document_number), '') is not null),
  department text not null check (nullif(btrim(department), '') is not null),
  requester_name text,
  po_number text not null check (nullif(btrim(po_number), '') is not null),
  po_file_name text not null,
  po_file_checksum text,
  item_count integer not null check (item_count >= 0),
  total numeric(17,2) not null check (total >= 0),
  line_message_id text,
  http_status integer check (http_status is null or http_status between 100 and 599),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'pending' and completed_at is null) or (status <> 'pending' and completed_at is not null))
);
create index if not exists service_purchase_request_line_notifications_request_idx
  on public.service_purchase_request_line_notifications (purchase_request_id, created_at desc);
create unique index if not exists service_purchase_request_line_notifications_pending_idx
  on public.service_purchase_request_line_notifications (purchase_request_id)
  where status = 'pending';

create or replace function public.begin_service_purchase_request_line_notification(
  p_request_id uuid,
  p_actor_id uuid,
  p_confirmed_attempt_id uuid,
  p_target_group_id text,
  p_document_url text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  attempt_row public.service_purchase_request_line_notifications%rowtype;
  latest_row public.service_purchase_request_line_notifications%rowtype;
  item_count integer;
  request_total numeric(17,2);
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if nullif(btrim(coalesce(p_target_group_id, '')), '') is null then
    raise exception using errcode = '23514', message = 'LINE group is not configured';
  end if;
  if p_document_url is null or p_document_url !~ '^https://' then
    raise exception using errcode = '23514', message = 'LINE document URL must use HTTPS';
  end if;
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if request_row.status not in ('confirmed', 'closed')
    or request_row.po_status = 'cancelled'
    or request_row.po_number is null
    or request_row.po_file_path is null then
    raise exception using errcode = '55000', message = 'service request must have an active PO number and file';
  end if;

  select * into attempt_row from public.service_purchase_request_line_notifications attempt
  where attempt.purchase_request_id = p_request_id and attempt.status = 'pending'
  order by attempt.created_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'attemptId', attempt_row.id, 'retryKey', attempt_row.retry_key,
      'targetGroupId', attempt_row.target_group_id, 'documentUrl', attempt_row.document_url,
      'documentNumber', attempt_row.document_number, 'department', attempt_row.department,
      'requesterName', attempt_row.requester_name, 'poNumber', attempt_row.po_number,
      'poFileName', attempt_row.po_file_name, 'poFileChecksum', attempt_row.po_file_checksum,
      'itemCount', attempt_row.item_count, 'total', attempt_row.total
    );
  end if;

  select * into latest_row from public.service_purchase_request_line_notifications attempt
  where attempt.purchase_request_id = p_request_id
  order by attempt.created_at desc limit 1 for update;
  if found and p_confirmed_attempt_id is distinct from latest_row.id then
    raise exception using errcode = '55000', message = 'LINE notification resend requires confirmation';
  end if;
  if found and latest_row.status = 'unknown' and latest_row.created_at >= now() - interval '24 hours' then
    update public.service_purchase_request_line_notifications
    set status = 'pending', completed_at = null, error_message = null, http_status = null, line_message_id = null
    where id = latest_row.id returning * into attempt_row;
    return jsonb_build_object(
      'attemptId', attempt_row.id, 'retryKey', attempt_row.retry_key,
      'targetGroupId', attempt_row.target_group_id, 'documentUrl', attempt_row.document_url,
      'documentNumber', attempt_row.document_number, 'department', attempt_row.department,
      'requesterName', attempt_row.requester_name, 'poNumber', attempt_row.po_number,
      'poFileName', attempt_row.po_file_name, 'poFileChecksum', attempt_row.po_file_checksum,
      'itemCount', attempt_row.item_count, 'total', attempt_row.total
    );
  end if;

  select count(*)::integer, coalesce(sum(item.line_total), 0)::numeric(17,2)
  into item_count, request_total
  from public.service_purchase_request_items item where item.purchase_request_id = p_request_id;
  insert into public.service_purchase_request_line_notifications (
    purchase_request_id, sent_by, status, target_group_id, document_url,
    document_number, department, requester_name, po_number, po_file_name,
    po_file_checksum, item_count, total
  ) values (
    p_request_id, p_actor_id, 'pending', btrim(p_target_group_id), p_document_url,
    request_row.document_number, request_row.department, request_row.requester_name,
    request_row.po_number, request_row.po_file_name, request_row.po_file_checksum,
    item_count, request_total
  ) returning * into attempt_row;
  return jsonb_build_object(
    'attemptId', attempt_row.id, 'retryKey', attempt_row.retry_key,
    'targetGroupId', attempt_row.target_group_id, 'documentUrl', attempt_row.document_url,
    'documentNumber', attempt_row.document_number, 'department', attempt_row.department,
    'requesterName', attempt_row.requester_name, 'poNumber', attempt_row.po_number,
    'poFileName', attempt_row.po_file_name, 'poFileChecksum', attempt_row.po_file_checksum,
    'itemCount', attempt_row.item_count, 'total', attempt_row.total
  );
end
$function$;
revoke execute on function public.begin_service_purchase_request_line_notification(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_service_purchase_request_line_notification(uuid, uuid, uuid, text, text) to service_role;

create or replace function public.complete_service_purchase_request_line_notification(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_status text,
  p_http_status integer,
  p_line_message_id text,
  p_error_message text
)
returns public.service_purchase_request_line_notifications
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  attempt_row public.service_purchase_request_line_notifications%rowtype;
begin
  perform public.service_procurement_assert_actor(p_actor_id, 'stock');
  if p_status not in ('succeeded', 'failed', 'unknown') then
    raise exception using errcode = '22023', message = 'invalid LINE notification completion status';
  end if;
  select * into attempt_row from public.service_purchase_request_line_notifications
  where id = p_attempt_id and sent_by = p_actor_id for update;
  if not found then raise exception using errcode = '23503', message = 'service LINE notification attempt not found'; end if;
  if attempt_row.status <> 'pending' then return attempt_row; end if;
  update public.service_purchase_request_line_notifications
  set status = p_status, http_status = p_http_status, line_message_id = p_line_message_id,
      error_message = nullif(btrim(coalesce(p_error_message, '')), ''), completed_at = now()
  where id = p_attempt_id returning * into attempt_row;
  return attempt_row;
end
$function$;
revoke execute on function public.complete_service_purchase_request_line_notification(uuid, uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.complete_service_purchase_request_line_notification(uuid, uuid, text, integer, text, text) to service_role;

alter table public.service_procurement_plans enable row level security;
alter table public.service_plan_responsibles enable row level security;
alter table public.service_plan_responsible_audit enable row level security;
alter table public.service_plan_budget_revisions enable row level security;
alter table public.service_purchase_requests enable row level security;
alter table public.service_purchase_request_items enable row level security;
alter table public.service_purchase_request_usage_events enable row level security;
alter table public.service_purchase_request_usage_items enable row level security;
alter table public.service_plan_ledger enable row level security;
alter table public.service_purchase_request_attachments enable row level security;
alter table public.service_purchase_request_committees enable row level security;
alter table public.service_purchase_request_po_events enable row level security;
alter table public.service_purchase_request_line_notifications enable row level security;

revoke all on table public.service_procurement_plans, public.service_plan_responsibles,
  public.service_plan_responsible_audit, public.service_plan_budget_revisions,
  public.service_purchase_requests, public.service_purchase_request_items,
  public.service_purchase_request_usage_events, public.service_purchase_request_usage_items,
  public.service_plan_ledger, public.service_purchase_request_attachments,
  public.service_purchase_request_committees, public.service_purchase_request_po_events,
  public.service_purchase_request_line_notifications
  from public, anon, authenticated;
grant select on table public.service_procurement_plans, public.service_plan_responsibles,
  public.service_plan_responsible_audit, public.service_plan_budget_revisions,
  public.service_purchase_requests, public.service_purchase_request_items,
  public.service_purchase_request_usage_events, public.service_purchase_request_usage_items,
  public.service_plan_ledger, public.service_purchase_request_attachments,
  public.service_purchase_request_committees, public.service_purchase_request_po_events,
  public.service_purchase_request_line_notifications
  to authenticated;
grant select, insert, update, delete on table public.service_procurement_plans,
  public.service_plan_responsibles, public.service_plan_responsible_audit,
  public.service_plan_budget_revisions, public.service_purchase_requests,
  public.service_purchase_request_items, public.service_purchase_request_usage_events,
  public.service_purchase_request_usage_items, public.service_plan_ledger,
  public.service_purchase_request_attachments, public.service_purchase_request_committees,
  public.service_purchase_request_po_events,
  public.service_purchase_request_line_notifications
  to service_role;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_procurement_plans', 'service_plan_responsibles', 'service_plan_responsible_audit',
    'service_plan_budget_revisions', 'service_purchase_requests', 'service_purchase_request_items',
    'service_purchase_request_usage_events', 'service_purchase_request_usage_items',
    'service_plan_ledger', 'service_purchase_request_attachments', 'service_purchase_request_committees',
    'service_purchase_request_po_events',
    'service_purchase_request_line_notifications'
  ] loop
    execute format('drop policy if exists %I_app_read on public.%I', table_name, table_name);
    execute format($policy$
      create policy %1$I_app_read on public.%1$I for select to authenticated using (
        exists (
          select 1 from public.profiles profile
          where profile.id = (select auth.uid()) and profile.status = 'active' and profile.deleted_at is null
        )
      )
    $policy$, table_name);
  end loop;
end
$policies$;

-- Out Lab is an empty legacy module in the target environment. Drop only its
-- tables/functions; the service domain above has no foreign keys to them.
drop function if exists public.assert_out_lab_usage_actor(uuid, uuid) cascade;
drop function if exists public.create_out_lab_contract(uuid, jsonb, date, text) cascade;
drop function if exists public.update_out_lab_contract(uuid, uuid, jsonb, timestamptz) cascade;
drop function if exists public.advance_out_lab_contract_stage(uuid, uuid, text, date, text, text) cascade;
drop function if exists public.record_out_lab_monthly_usage(uuid, uuid, numeric, date, text) cascade;
drop function if exists public.delete_out_lab_monthly_usage(uuid, uuid) cascade;
drop function if exists public.set_out_lab_responsible_users(uuid, uuid, uuid[], text) cascade;
drop function if exists public.set_out_lab_contract_file(uuid, uuid, text) cascade;
drop function if exists public.archive_out_lab_contract(uuid, uuid, text) cascade;
drop function if exists public.restore_out_lab_contract(uuid, uuid) cascade;
drop function if exists public.expire_out_lab_contract(uuid, uuid, text) cascade;
drop table if exists public.out_lab_responsible_audit cascade;
drop table if exists public.out_lab_contract_stage_history cascade;
drop table if exists public.out_lab_monthly_usage cascade;
drop table if exists public.out_lab_contracts cascade;

commit;
