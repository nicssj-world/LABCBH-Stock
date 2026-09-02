-- Red Cross Thailand purchase PRs use the normal purchase-order/receiving
-- workflow, but their financial events live in their own tables. This keeps
-- the service-procurement ledger and its invoice-summary counter untouched.
begin;

alter table public.purchase_requests
  drop constraint if exists purchase_requests_purchase_method_check;

alter table public.purchase_requests
  add constraint purchase_requests_purchase_method_check
  check (purchase_method in (
    'annual_plan',
    'contract',
    'awaiting_contract',
    'off_plan',
    'specific_contract',
    'e_bidding',
    'equipment_lease',
    'red_cross'
  ));

create table if not exists public.purchase_request_expenses (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  expense_date date not null,
  amount numeric(17,2) not null check (amount > 0),
  invoice_number text,
  note text,
  document_kind text not null default 'invoice',
  source_expense_id uuid references public.purchase_request_expenses(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_request_expenses_document_check check (
    (document_kind = 'invoice' and source_expense_id is null)
    or (
      document_kind = 'credit_note'
      and source_expense_id is not null
      and nullif(btrim(invoice_number), '') is not null
    )
  ),
  constraint purchase_request_expenses_source_not_self_check check (
    source_expense_id is null or source_expense_id <> id
  ),
  constraint purchase_request_expenses_cancelled_state_check check (
    (status = 'active' and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);

create index if not exists purchase_request_expenses_request_idx
  on public.purchase_request_expenses (purchase_request_id, expense_date desc, created_at desc);
create index if not exists purchase_request_expenses_source_idx
  on public.purchase_request_expenses (source_expense_id)
  where source_expense_id is not null;
create unique index if not exists purchase_request_expenses_invoice_unique
  on public.purchase_request_expenses (purchase_request_id, lower(btrim(invoice_number)))
  where nullif(btrim(invoice_number), '') is not null;

create table if not exists public.purchase_request_expense_audits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.purchase_request_expenses(id) on delete restrict,
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  action text not null check (action in ('created', 'updated', 'cancelled')),
  before_data jsonb,
  after_data jsonb,
  reason text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists purchase_request_expense_audits_request_idx
  on public.purchase_request_expense_audits (purchase_request_id, created_at desc);
create index if not exists purchase_request_expense_audits_expense_idx
  on public.purchase_request_expense_audits (expense_id, created_at desc);

drop trigger if exists purchase_request_expenses_updated_at on public.purchase_request_expenses;
create trigger purchase_request_expenses_updated_at
before update on public.purchase_request_expenses
for each row execute function public.lab_stock_set_updated_at();

drop trigger if exists purchase_request_expense_audits_append_only on public.purchase_request_expense_audits;
create trigger purchase_request_expense_audits_append_only
before update or delete on public.purchase_request_expense_audits
for each row execute function public.prevent_append_only_mutation();

alter table public.purchase_request_expenses enable row level security;
alter table public.purchase_request_expense_audits enable row level security;

revoke all on table public.purchase_request_expenses, public.purchase_request_expense_audits
  from anon, authenticated;
grant select on table public.purchase_request_expenses, public.purchase_request_expense_audits
  to authenticated;
grant select, insert, update, delete on table public.purchase_request_expenses,
  public.purchase_request_expense_audits to service_role;

drop policy if exists purchase_request_expenses_app_read on public.purchase_request_expenses;
create policy purchase_request_expenses_app_read
on public.purchase_request_expenses for select to authenticated using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
  )
);

drop policy if exists purchase_request_expense_audits_app_read on public.purchase_request_expense_audits;
create policy purchase_request_expense_audits_app_read
on public.purchase_request_expense_audits for select to authenticated using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
  )
);

-- A reversed Red Cross PR must not strand active financial events. Existing
-- purchase methods keep their original reversal behavior.
create or replace function public.guard_purchase_request_expense_reversal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'reversed'
     and old.status is distinct from new.status
     and new.purchase_method = 'red_cross'
     and exists (
       select 1
       from public.purchase_request_expenses expense
       where expense.purchase_request_id = new.id
         and expense.status = 'active'
     ) then
    raise exception using
      errcode = '55000',
      message = 'purchase request with active expenses cannot be reversed';
  end if;
  return new;
end
$function$;

revoke execute on function public.guard_purchase_request_expense_reversal() from public, anon, authenticated;
drop trigger if exists purchase_requests_guard_expense_reversal on public.purchase_requests;
create trigger purchase_requests_guard_expense_reversal
before update of status on public.purchase_requests
for each row execute function public.guard_purchase_request_expense_reversal();

create or replace function public.record_purchase_request_expense(
  p_actor_id uuid,
  p_request_id uuid,
  p_expense_date date,
  p_amount numeric,
  p_invoice_number text default null,
  p_note text default null,
  p_document_kind text default 'invoice',
  p_source_expense_id uuid default null
)
returns public.purchase_request_expenses
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.purchase_requests%rowtype;
  expense_row public.purchase_request_expenses%rowtype;
  source_row public.purchase_request_expenses%rowtype;
  document_kind_value text;
  invoice_number_value text;
  request_total numeric(17,2);
  active_net numeric(17,2);
  credited_amount numeric(17,2);
  source_remaining numeric(17,2);
begin
  select request.*
  into request_row
  from public.purchase_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  perform public.assert_purchase_request_manager(p_actor_id, request_row.requester_id);

  if request_row.purchase_method <> 'red_cross' then
    raise exception using errcode = '55000', message = 'expenses are only available for Red Cross purchase requests';
  end if;
  if request_row.status not in ('completed', 'partially_received', 'received', 'closed_short')
     or (nullif(btrim(coalesce(request_row.po_number, '')), '') is null
         and nullif(btrim(coalesce(request_row.po_file_name, '')), '') is null) then
    raise exception using
      errcode = '55000',
      message = 'purchase PR must be confirmed and have PO evidence before recording expense';
  end if;
  if p_expense_date is null or p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception using errcode = '22023', message = 'expense date or amount is invalid';
  end if;

  document_kind_value := lower(btrim(coalesce(p_document_kind, 'invoice')));
  invoice_number_value := nullif(btrim(coalesce(p_invoice_number, '')), '');
  if document_kind_value not in ('invoice', 'credit_note') then
    raise exception using errcode = '22023', message = 'expense document type is invalid';
  end if;
  if document_kind_value = 'invoice' and p_source_expense_id is not null then
    raise exception using errcode = '22023', message = 'invoice cannot reference a source expense';
  end if;
  if document_kind_value = 'credit_note' then
    if invoice_number_value is null then
      raise exception using errcode = '22023', message = 'credit note number is required';
    end if;
    if p_source_expense_id is null then
      raise exception using errcode = '22023', message = 'credit note source invoice is required';
    end if;
  end if;

  -- The request row is the serialization point for all financial events on
  -- this PR. The unique invoice index is a second, database-level guard for
  -- duplicate numbers across concurrent callers.
  perform 1
  from public.purchase_request_expenses expense
  where expense.purchase_request_id = p_request_id
  for update;

  if document_kind_value = 'credit_note' then
    select expense.*
    into source_row
    from public.purchase_request_expenses expense
    where expense.id = p_source_expense_id
      and expense.purchase_request_id = p_request_id
      and expense.document_kind = 'invoice'
      and expense.status = 'active'
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'credit note source invoice not found or inactive';
    end if;

    select coalesce(sum(expense.amount), 0)
    into credited_amount
    from public.purchase_request_expenses expense
    where expense.purchase_request_id = p_request_id
      and expense.source_expense_id = p_source_expense_id
      and expense.document_kind = 'credit_note'
      and expense.status = 'active';
    source_remaining := round(source_row.amount - credited_amount, 2);
    if p_amount > source_remaining then
      raise exception using errcode = '23514', message = 'credit note exceeds remaining source invoice amount';
    end if;
  end if;

  select coalesce(sum(item.line_total), 0)
  into request_total
  from public.purchase_request_items item
  where item.purchase_request_id = p_request_id;

  select coalesce(sum(
    case when expense.document_kind = 'credit_note' then -expense.amount else expense.amount end
  ), 0)
  into active_net
  from public.purchase_request_expenses expense
  where expense.purchase_request_id = p_request_id
    and expense.status = 'active';

  if document_kind_value = 'invoice' and active_net + p_amount > request_total then
    raise exception using errcode = '23514', message = 'active expenses exceed PR ceiling';
  end if;

  insert into public.purchase_request_expenses (
    purchase_request_id,
    expense_date,
    amount,
    invoice_number,
    note,
    document_kind,
    source_expense_id,
    created_by,
    updated_by
  )
  values (
    p_request_id,
    p_expense_date,
    p_amount,
    invoice_number_value,
    nullif(btrim(coalesce(p_note, '')), ''),
    document_kind_value,
    p_source_expense_id,
    p_actor_id,
    p_actor_id
  )
  returning * into expense_row;

  insert into public.purchase_request_expense_audits (
    expense_id, purchase_request_id, action, before_data, after_data, actor_id
  )
  values (
    expense_row.id, p_request_id, 'created', null, to_jsonb(expense_row), p_actor_id
  );

  return expense_row;
end
$function$;

revoke execute on function public.record_purchase_request_expense(uuid, uuid, date, numeric, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_purchase_request_expense(uuid, uuid, date, numeric, text, text, text, uuid)
  to service_role;

create or replace function public.update_purchase_request_expense(
  p_actor_id uuid,
  p_request_id uuid,
  p_expense_id uuid,
  p_expense_date date,
  p_amount numeric,
  p_invoice_number text default null,
  p_note text default null,
  p_reason text default null
)
returns public.purchase_request_expenses
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.purchase_requests%rowtype;
  expense_row public.purchase_request_expenses%rowtype;
  source_row public.purchase_request_expenses%rowtype;
  before_data jsonb;
  invoice_number_value text;
  request_total numeric(17,2);
  active_net numeric(17,2);
  credited_amount numeric(17,2);
  source_remaining numeric(17,2);
begin
  select request.*
  into request_row
  from public.purchase_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;
  perform public.assert_purchase_request_manager(p_actor_id, request_row.requester_id);

  if request_row.purchase_method <> 'red_cross' then
    raise exception using errcode = '55000', message = 'expenses are only available for Red Cross purchase requests';
  end if;
  if request_row.status not in ('completed', 'partially_received', 'received', 'closed_short')
     or (nullif(btrim(coalesce(request_row.po_number, '')), '') is null
         and nullif(btrim(coalesce(request_row.po_file_name, '')), '') is null) then
    raise exception using
      errcode = '55000',
      message = 'purchase PR must be confirmed and have PO evidence before recording expense';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '23514', message = 'expense edit requires a reason';
  end if;
  if p_expense_date is null or p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception using errcode = '22023', message = 'expense date or amount is invalid';
  end if;

  perform 1
  from public.purchase_request_expenses expense
  where expense.purchase_request_id = p_request_id
  for update;

  select expense.*
  into expense_row
  from public.purchase_request_expenses expense
  where expense.id = p_expense_id
    and expense.purchase_request_id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'purchase expense not found';
  end if;
  if expense_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'cancelled purchase expense cannot be edited';
  end if;

  invoice_number_value := nullif(btrim(coalesce(p_invoice_number, '')), '');

  if expense_row.document_kind = 'credit_note' then
    if invoice_number_value is null then
      raise exception using errcode = '22023', message = 'credit note number is required';
    end if;
    select expense.*
    into source_row
    from public.purchase_request_expenses expense
    where expense.id = expense_row.source_expense_id
      and expense.purchase_request_id = p_request_id
      and expense.document_kind = 'invoice'
      and expense.status = 'active'
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'credit note source invoice not found or inactive';
    end if;

    select coalesce(sum(expense.amount), 0)
    into credited_amount
    from public.purchase_request_expenses expense
    where expense.purchase_request_id = p_request_id
      and expense.source_expense_id = expense_row.source_expense_id
      and expense.document_kind = 'credit_note'
      and expense.status = 'active'
      and expense.id <> p_expense_id;
    source_remaining := round(source_row.amount - credited_amount, 2);
    if p_amount > source_remaining then
      raise exception using errcode = '23514', message = 'credit note exceeds remaining source invoice amount';
    end if;
  end if;

  select coalesce(sum(item.line_total), 0)
  into request_total
  from public.purchase_request_items item
  where item.purchase_request_id = p_request_id;

  select coalesce(sum(
    case when expense.document_kind = 'credit_note' then -expense.amount else expense.amount end
  ), 0)
  into active_net
  from public.purchase_request_expenses expense
  where expense.purchase_request_id = p_request_id
    and expense.status = 'active'
    and expense.id <> p_expense_id;

  if expense_row.document_kind = 'invoice' and active_net + p_amount > request_total then
    raise exception using errcode = '23514', message = 'active expenses exceed PR ceiling';
  end if;
  if expense_row.document_kind = 'invoice'
     and exists (
       select 1
       from public.purchase_request_expenses credit
       where credit.purchase_request_id = p_request_id
         and credit.source_expense_id = p_expense_id
         and credit.document_kind = 'credit_note'
         and credit.status = 'active'
         and credit.amount > p_amount
     ) then
    raise exception using errcode = '23514', message = 'invoice cannot be reduced below active credit notes';
  end if;

  before_data := to_jsonb(expense_row);
  update public.purchase_request_expenses
  set expense_date = p_expense_date,
      amount = p_amount,
      invoice_number = invoice_number_value,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_by = p_actor_id
  where id = p_expense_id
  returning * into expense_row;

  insert into public.purchase_request_expense_audits (
    expense_id, purchase_request_id, action, before_data, after_data, reason, actor_id
  )
  values (
    expense_row.id, p_request_id, 'updated', before_data, to_jsonb(expense_row), btrim(p_reason), p_actor_id
  );

  return expense_row;
end
$function$;

revoke execute on function public.update_purchase_request_expense(uuid, uuid, uuid, date, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_purchase_request_expense(uuid, uuid, uuid, date, numeric, text, text, text)
  to service_role;

create or replace function public.cancel_purchase_request_expense(
  p_actor_id uuid,
  p_request_id uuid,
  p_expense_id uuid,
  p_reason text
)
returns public.purchase_request_expenses
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  request_row public.purchase_requests%rowtype;
  expense_row public.purchase_request_expenses%rowtype;
  before_data jsonb;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '23514', message = 'expense cancellation requires a reason';
  end if;

  select request.*
  into request_row
  from public.purchase_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;
  perform public.assert_purchase_request_manager(p_actor_id, request_row.requester_id);

  if request_row.purchase_method <> 'red_cross' then
    raise exception using errcode = '55000', message = 'expenses are only available for Red Cross purchase requests';
  end if;
  if request_row.status not in ('completed', 'partially_received', 'received', 'closed_short')
     or (nullif(btrim(coalesce(request_row.po_number, '')), '') is null
         and nullif(btrim(coalesce(request_row.po_file_name, '')), '') is null) then
    raise exception using
      errcode = '55000',
      message = 'purchase PR must be confirmed and have PO evidence before recording expense';
  end if;

  perform 1
  from public.purchase_request_expenses expense
  where expense.purchase_request_id = p_request_id
  for update;

  select expense.*
  into expense_row
  from public.purchase_request_expenses expense
  where expense.id = p_expense_id
    and expense.purchase_request_id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'purchase expense not found';
  end if;
  if expense_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'cancelled purchase expense cannot be cancelled';
  end if;
  if expense_row.document_kind = 'invoice'
     and exists (
       select 1
       from public.purchase_request_expenses credit
       where credit.purchase_request_id = p_request_id
         and credit.source_expense_id = p_expense_id
         and credit.document_kind = 'credit_note'
         and credit.status = 'active'
     ) then
    raise exception using errcode = '55000', message = 'invoice with active credit notes cannot be cancelled';
  end if;

  before_data := to_jsonb(expense_row);
  update public.purchase_request_expenses
  set status = 'cancelled',
      cancelled_by = p_actor_id,
      cancelled_at = now(),
      updated_by = p_actor_id
  where id = p_expense_id
  returning * into expense_row;

  insert into public.purchase_request_expense_audits (
    expense_id, purchase_request_id, action, before_data, after_data, reason, actor_id
  )
  values (
    expense_row.id, p_request_id, 'cancelled', before_data, to_jsonb(expense_row), btrim(p_reason), p_actor_id
  );

  return expense_row;
end
$function$;

revoke execute on function public.cancel_purchase_request_expense(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_purchase_request_expense(uuid, uuid, uuid, text)
  to service_role;

-- Patch only the method allowlists and annual-plan attachment branch in the
-- already-final purchase/receiving functions. Their workflow bodies remain
-- byte-for-byte sourced from the latest migrations, which limits regression
-- risk for existing methods.
do $patch$
declare
  function_oid oid;
  definition text;
  patched text;
begin
  foreach function_oid in array array[
    'public.create_purchase_request(uuid, jsonb, jsonb)'::regprocedure::oid,
    'public.update_purchase_request(uuid, uuid, jsonb, jsonb)'::regprocedure::oid,
    'public.apply_purchase_request_checklist(uuid, uuid, uuid, jsonb, jsonb, boolean)'::regprocedure::oid,
    'public.apply_purchase_request_annual_plan_reference(uuid, uuid, jsonb)'::regprocedure::oid,
    'public.enforce_current_annual_plan_reference()'::regprocedure::oid,
    'public.require_generated_annual_plan_attachment()'::regprocedure::oid,
    'public.create_purchase_request_with_annual_plan_checklist(uuid, jsonb, jsonb, uuid, jsonb, jsonb, jsonb)'::regprocedure::oid,
    'public.update_purchase_request_with_annual_plan_checklist(uuid, uuid, jsonb, jsonb, uuid, jsonb, jsonb, jsonb)'::regprocedure::oid,
    'public.create_goods_receipt(uuid, jsonb, jsonb)'::regprocedure::oid,
    'public.mark_purchase_request_received_outside_stock(uuid, uuid)'::regprocedure::oid
  ] loop
    select pg_get_functiondef(function_oid) into definition;
    patched := definition;

    if function_oid in (
      'public.create_purchase_request(uuid, jsonb, jsonb)'::regprocedure::oid,
      'public.update_purchase_request(uuid, uuid, jsonb, jsonb)'::regprocedure::oid
    ) then
      patched := regexp_replace(
        patched,
        $$'specific_contract'[[:space:]]*,[[:space:]]*'e_bidding'[[:space:]]*,[[:space:]]*'equipment_lease'$$,
        $$'specific_contract', 'e_bidding', 'equipment_lease', 'red_cross'$$,
        'g'
      );
    end if;

    if function_oid in (
      'public.apply_purchase_request_checklist(uuid, uuid, uuid, jsonb, jsonb, boolean)'::regprocedure::oid,
      'public.apply_purchase_request_annual_plan_reference(uuid, uuid, jsonb)'::regprocedure::oid,
      'public.enforce_current_annual_plan_reference()'::regprocedure::oid,
      'public.require_generated_annual_plan_attachment()'::regprocedure::oid,
      'public.create_purchase_request_with_annual_plan_checklist(uuid, jsonb, jsonb, uuid, jsonb, jsonb, jsonb)'::regprocedure::oid,
      'public.update_purchase_request_with_annual_plan_checklist(uuid, uuid, jsonb, jsonb, uuid, jsonb, jsonb, jsonb)'::regprocedure::oid
    ) then
      patched := regexp_replace(
        patched,
        $$'annual_plan'[[:space:]]*,[[:space:]]*'specific_contract'[[:space:]]*,[[:space:]]*'e_bidding'[[:space:]]*,[[:space:]]*'equipment_lease'$$,
        $$'annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease', 'red_cross'$$,
        'g'
      );
    end if;

    if function_oid = 'public.apply_purchase_request_checklist(uuid, uuid, uuid, jsonb, jsonb, boolean)'::regprocedure::oid then
      patched := regexp_replace(
        patched,
        $$case when target_request.purchase_method = 'annual_plan' then 1 else 0 end$$,
        $$case when target_request.purchase_method in ('annual_plan', 'red_cross') then 1 else 0 end$$,
        'g'
      );
    end if;

    if function_oid in (
      'public.create_goods_receipt(uuid, jsonb, jsonb)'::regprocedure::oid,
      'public.mark_purchase_request_received_outside_stock(uuid, uuid)'::regprocedure::oid
    ) then
      patched := regexp_replace(
        patched,
        $$'annual_plan'[[:space:]]*,[[:space:]]*'contract'[[:space:]]*,[[:space:]]*'awaiting_contract'[[:space:]]*,[[:space:]]*'off_plan'$$,
        $$'annual_plan', 'contract', 'awaiting_contract', 'off_plan', 'red_cross'$$,
        'g'
      );
    end if;

    if patched = definition then
      raise exception using
        errcode = '55000',
        message = format('Red Cross method allowlist was not found in %s', function_oid::text);
    end if;
    execute patched;
  end loop;
end
$patch$;

commit;
