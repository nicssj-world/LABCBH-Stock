-- Assign one immutable, human-entered invoice-summary number to each Red
-- Cross service PO. The unique fiscal-year/sequence key is the final guard
-- against duplicate numbers; the RPC also serializes automatic numbering so
-- two exports cannot receive the same suggestion at the same time.
begin;

create table if not exists public.service_purchase_request_invoice_numbers (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.service_purchase_requests(id) on delete restrict,
  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  sequence_number integer not null check (sequence_number between 1 and 999999),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (purchase_request_id),
  unique (fiscal_year, sequence_number)
);
create index if not exists service_purchase_request_invoice_numbers_fiscal_year_idx
  on public.service_purchase_request_invoice_numbers (fiscal_year, sequence_number desc);

create or replace function public.service_invoice_summary_number_label(
  p_sequence_number integer,
  p_fiscal_year integer
)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select lpad(p_sequence_number::text, 2, '0') || '/' || p_fiscal_year::text;
$function$;
revoke execute on function public.service_invoice_summary_number_label(integer, integer) from public, anon, authenticated;
grant execute on function public.service_invoice_summary_number_label(integer, integer) to service_role;

create or replace function public.get_service_invoice_summary_number(
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  number_row public.service_purchase_request_invoice_numbers%rowtype;
  is_red_cross_value boolean;
  next_sequence integer;
begin
  select * into request_row
  from public.service_purchase_requests
  where id = p_request_id;
  if not found then
    raise exception using errcode = '23503', message = 'service purchase request not found';
  end if;

  select plan.is_red_cross into is_red_cross_value
  from public.service_procurement_plans plan
  where plan.id = request_row.plan_id;
  if not coalesce(is_red_cross_value, false) then
    raise exception using errcode = '42501', message = 'invoice summary numbering is only available for Red Cross service requests';
  end if;

  select * into number_row
  from public.service_purchase_request_invoice_numbers
  where purchase_request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'assignedNumber', public.service_invoice_summary_number_label(number_row.sequence_number, number_row.fiscal_year),
      'suggestedNumber', public.service_invoice_summary_number_label(number_row.sequence_number, number_row.fiscal_year),
      'fiscalYear', request_row.fiscal_year
    );
  end if;

  select coalesce(max(sequence_number), 0) + 1
  into next_sequence
  from public.service_purchase_request_invoice_numbers
  where fiscal_year = request_row.fiscal_year;
  if next_sequence > 999999 then
    raise exception using errcode = '22023', message = 'เลขสรุปใบแจ้งหนี้ของปีงบประมาณนี้เต็มแล้ว';
  end if;

  return jsonb_build_object(
    'assignedNumber', null,
    'suggestedNumber', public.service_invoice_summary_number_label(next_sequence, request_row.fiscal_year),
    'fiscalYear', request_row.fiscal_year
  );
end
$function$;
revoke execute on function public.get_service_invoice_summary_number(uuid) from public, anon, authenticated;
grant execute on function public.get_service_invoice_summary_number(uuid) to service_role;

create or replace function public.claim_service_invoice_summary_number(
  p_request_id uuid,
  p_actor_id uuid,
  p_requested_number text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  number_row public.service_purchase_request_invoice_numbers%rowtype;
  is_red_cross_value boolean;
  requested_value text;
  requested_sequence integer;
  requested_year integer;
  assigned_sequence integer;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id
      and profile.status = 'active'
      and profile.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'service procurement actor is not active';
  end if;

  select * into request_row
  from public.service_purchase_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'service purchase request not found';
  end if;

  select plan.is_red_cross into is_red_cross_value
  from public.service_procurement_plans plan
  where plan.id = request_row.plan_id;
  if not coalesce(is_red_cross_value, false) then
    raise exception using errcode = '42501', message = 'invoice summary numbering is only available for Red Cross service requests';
  end if;

  requested_value := nullif(btrim(coalesce(p_requested_number, '')), '');
  if requested_value is not null then
    if requested_value !~ '^[0-9]{1,6}/[0-9]{4}$' then
      raise exception using errcode = '22023', message = 'เลขสรุปใบแจ้งหนี้ต้องอยู่ในรูปแบบ xx/ปีงบประมาณ เช่น 01/2569';
    end if;
    requested_sequence := split_part(requested_value, '/', 1)::integer;
    requested_year := split_part(requested_value, '/', 2)::integer;
    if requested_sequence < 1 or requested_sequence > 999999 then
      raise exception using errcode = '22023', message = 'เลขสรุปใบแจ้งหนี้ต้องเริ่มที่ 01';
    end if;
    if requested_year <> request_row.fiscal_year then
      raise exception using errcode = '22023', message = 'ปีของเลขสรุปใบแจ้งหนี้ต้องตรงกับปีงบประมาณของ PR';
    end if;
  end if;

  select * into number_row
  from public.service_purchase_request_invoice_numbers
  where purchase_request_id = p_request_id
  for update;
  if found then
    if requested_value is not null
      and (requested_sequence <> number_row.sequence_number or requested_year <> number_row.fiscal_year) then
      raise exception using errcode = '55000', message = format(
        'ใบ PR นี้ได้รับเลขสรุปใบแจ้งหนี้ %s แล้ว ไม่สามารถเปลี่ยนเลขได้',
        public.service_invoice_summary_number_label(number_row.sequence_number, number_row.fiscal_year)
      );
    end if;
    return jsonb_build_object(
      'number', public.service_invoice_summary_number_label(number_row.sequence_number, number_row.fiscal_year),
      'alreadyAssigned', true
    );
  end if;

  -- Serialize only the fiscal year being numbered. The request-row lock above
  -- separately makes repeat exports of one PO idempotent.
  perform pg_advisory_xact_lock(830000000000::bigint + request_row.fiscal_year::bigint);
  if requested_value is null then
    select coalesce(max(sequence_number), 0) + 1
    into assigned_sequence
    from public.service_purchase_request_invoice_numbers
    where fiscal_year = request_row.fiscal_year;
  else
    assigned_sequence := requested_sequence;
  end if;
  if assigned_sequence > 999999 then
    raise exception using errcode = '22023', message = 'เลขสรุปใบแจ้งหนี้ของปีงบประมาณนี้เต็มแล้ว';
  end if;
  if exists (
    select 1
    from public.service_purchase_request_invoice_numbers
    where fiscal_year = request_row.fiscal_year
      and sequence_number = assigned_sequence
  ) then
    raise exception using errcode = '23505', message = 'เลขสรุปใบแจ้งหนี้นี้ถูกใช้แล้ว';
  end if;

  insert into public.service_purchase_request_invoice_numbers (
    purchase_request_id, fiscal_year, sequence_number, assigned_by
  ) values (
    p_request_id, request_row.fiscal_year, assigned_sequence, p_actor_id
  ) returning * into number_row;

  return jsonb_build_object(
    'number', public.service_invoice_summary_number_label(number_row.sequence_number, number_row.fiscal_year),
    'alreadyAssigned', false
  );
end
$function$;
revoke execute on function public.claim_service_invoice_summary_number(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_service_invoice_summary_number(uuid, uuid, text) to service_role;

alter table public.service_purchase_request_invoice_numbers enable row level security;
revoke all on table public.service_purchase_request_invoice_numbers from public, anon, authenticated;
grant select, insert, update, delete on table public.service_purchase_request_invoice_numbers to service_role;

commit;
