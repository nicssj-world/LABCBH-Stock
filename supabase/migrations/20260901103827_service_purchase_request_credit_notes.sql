-- Forward-only credit-note support for Red Cross service PR expenses.
-- Credit notes remain positive document amounts and are projected as negative
-- exposure when calculating the request/plan net expense.
begin;

alter table public.service_purchase_request_expenses
  add column if not exists document_kind text not null default 'invoice',
  add column if not exists source_expense_id uuid;

alter table public.service_purchase_request_expenses
  drop constraint if exists service_purchase_request_expenses_source_fk,
  drop constraint if exists service_purchase_request_expenses_document_kind_check,
  drop constraint if exists service_purchase_request_expenses_source_not_self_check;

alter table public.service_purchase_request_expenses
  add constraint service_purchase_request_expenses_source_fk
    foreign key (source_expense_id)
    references public.service_purchase_request_expenses(id)
    on delete restrict,
  add constraint service_purchase_request_expenses_document_kind_check
    check (
      (document_kind = 'invoice' and source_expense_id is null)
      or (
        document_kind = 'credit_note'
        and source_expense_id is not null
        and nullif(btrim(invoice_number), '') is not null
      )
    ),
  add constraint service_purchase_request_expenses_source_not_self_check
    check (source_expense_id is null or source_expense_id <> id);

create index if not exists service_purchase_request_expenses_source_idx
  on public.service_purchase_request_expenses(source_expense_id)
  where source_expense_id is not null;

-- Replace the old close calculation so the plan ledger receives net expense.
create or replace function public.close_service_purchase_request_po(p_actor_id uuid, p_request_id uuid, p_reason text default null)
returns public.service_purchase_requests language plpgsql security invoker set search_path = '' as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  expense_total numeric(17,2);
  remaining_reservation numeric(17,2);
  plan_row public.service_procurement_plans%rowtype;
begin
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  if not (public.service_procurement_actor_has_role(p_actor_id, 'admin') or request_row.requester_id = p_actor_id
    or exists (
      select 1
      from public.service_plan_responsibles responsible
      join public.profiles responsible_profile on responsible_profile.id = responsible.profile_id
      where responsible.plan_id = request_row.plan_id and responsible.profile_id = p_actor_id
        and responsible_profile.status = 'active' and responsible_profile.deleted_at is null
    )) then
    raise exception using errcode = '42501', message = 'only the PR requester or plan expense recorder may close this service PO';
  end if;
  if request_row.status = 'closed' and request_row.po_status = 'closed' then return request_row; end if;
  if request_row.status <> 'confirmed' or request_row.po_status in ('closed', 'cancelled')
    or request_row.po_number is null or request_row.po_file_path is null then raise exception using errcode = '55000', message = 'service PO requires both number and file before closing'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if not found or plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot close a new PO'; end if;
  perform 1 from public.service_purchase_request_expenses expense where expense.purchase_request_id = p_request_id for update;
  select coalesce(sum(case when expense.document_kind = 'credit_note' then -expense.amount else expense.amount end), 0)
    into expense_total
    from public.service_purchase_request_expenses expense
    where expense.purchase_request_id = p_request_id and expense.status = 'active';
  if expense_total < 0 then raise exception using errcode = '23514', message = 'service credit notes exceed invoice amounts'; end if;
  if expense_total > request_row.requested_amount then raise exception using errcode = '23514', message = 'service expenses exceed PR ceiling'; end if;
  if expense_total > 0 then
    insert into public.service_plan_ledger(plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id)
    values (plan_row.id, 'expense', expense_total, (timezone('Asia/Bangkok', now()))::date, p_request_id, 'ค่าใช้จ่ายจริงสุทธิเมื่อปิด PO งานจ้าง', request_row.document_number, p_actor_id);
  end if;
  select coalesce(sum(case when ledger.entry_kind = 'reservation' then ledger.amount when ledger.entry_kind = 'reservation_release' then ledger.amount else 0 end), 0)
    into remaining_reservation from public.service_plan_ledger ledger where ledger.purchase_request_id = p_request_id;
  if remaining_reservation > 0 then
    insert into public.service_plan_ledger(plan_id, entry_kind, amount, event_date, purchase_request_id, reason, source_reference, actor_id)
    values (plan_row.id, 'reservation_release', -remaining_reservation, (timezone('Asia/Bangkok', now()))::date, p_request_id, coalesce(nullif(btrim(p_reason), ''), 'คืนยอดสำรองเมื่อปิด PO'), request_row.document_number, p_actor_id);
  end if;
  update public.service_purchase_requests set status = 'closed', po_status = 'closed', closed_by = p_actor_id, closed_at = now(), updated_by = p_actor_id where id = p_request_id returning * into request_row;
  insert into public.service_purchase_request_po_events(purchase_request_id, event_kind, po_number, po_file_path, reason, actor_id)
  values (p_request_id, 'closed', request_row.po_number, request_row.po_file_path, nullif(btrim(coalesce(p_reason, '')), ''), p_actor_id);
  return request_row;
end
$function$;
revoke execute on function public.close_service_purchase_request_po(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.close_service_purchase_request_po(uuid, uuid, text) to service_role;

-- The latest effective record RPC is recreated with document metadata. The
-- defaults preserve compatibility for callers that still submit a normal
-- invoice using the original six arguments.
drop function if exists public.record_service_purchase_request_expense(uuid, uuid, date, numeric, text, text);
create function public.record_service_purchase_request_expense(
  p_actor_id uuid, p_request_id uuid, p_expense_date date, p_amount numeric,
  p_invoice_number text default null, p_note text default null,
  p_document_kind text default 'invoice', p_source_expense_id uuid default null
)
returns public.service_purchase_request_expenses language plpgsql security invoker set search_path = '' as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  expense_row public.service_purchase_request_expenses%rowtype;
  source_row public.service_purchase_request_expenses%rowtype;
  active_net numeric(17,2);
  credited_total numeric(17,2);
  source_remaining numeric(17,2);
  frequency_value text;
  document_kind_value text := lower(nullif(btrim(coalesce(p_document_kind, '')), ''));
  invoice_number_value text := nullif(btrim(coalesce(p_invoice_number, '')), '');
begin
  document_kind_value := coalesce(document_kind_value, 'invoice');
  select * into request_row from public.service_purchase_requests where id = p_request_id for update;
  if not found then raise exception using errcode = '23503', message = 'service purchase request not found'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.plan_id is null then raise exception using errcode = '55000', message = 'service expense must reference a plan'; end if;
  if p_amount is null or p_amount <= 0 then raise exception using errcode = '22023', message = 'expense amount must be positive'; end if;
  if p_expense_date is null or p_expense_date < request_row.usage_start_date or p_expense_date > request_row.usage_end_date then raise exception using errcode = '22023', message = 'expense date must be inside PO usage range'; end if;
  if request_row.status <> 'confirmed'
    or request_row.po_status in ('closed', 'cancelled')
    or (request_row.po_number is null and request_row.po_file_path is null) then
    raise exception using errcode = '55000', message = 'service PR must be confirmed and have PO evidence before recording expense';
  end if;
  if document_kind_value not in ('invoice', 'credit_note') then raise exception using errcode = '22023', message = 'invalid service expense document kind'; end if;
  if document_kind_value = 'invoice' and p_source_expense_id is not null then raise exception using errcode = '23514', message = 'invoice cannot reference a source expense'; end if;
  if document_kind_value = 'credit_note' and invoice_number_value is null then raise exception using errcode = '23514', message = 'credit note number is required'; end if;

  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if not found or plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot record expense'; end if;
  if document_kind_value = 'credit_note' and not plan_row.is_red_cross then raise exception using errcode = '23514', message = 'credit notes are only available for Red Cross service plans'; end if;

  frequency_value := case when plan_row.is_red_cross then 'daily' else 'monthly' end;
  perform 1 from public.service_purchase_request_expenses expense where expense.purchase_request_id = p_request_id for update;
  if document_kind_value = 'credit_note' then
    select * into source_row
      from public.service_purchase_request_expenses expense
      where expense.id = p_source_expense_id and expense.purchase_request_id = p_request_id
      for update;
    if not found or source_row.status <> 'active' or source_row.document_kind <> 'invoice' then
      raise exception using errcode = '23503', message = 'credit note source invoice not found or inactive';
    end if;
    select coalesce(sum(credit.amount), 0)
      into credited_total
      from public.service_purchase_request_expenses credit
      where credit.purchase_request_id = p_request_id
        and credit.source_expense_id = source_row.id
        and credit.document_kind = 'credit_note'
        and credit.status = 'active';
    source_remaining := source_row.amount - credited_total;
    if p_amount > source_remaining then raise exception using errcode = '23514', message = 'credit note exceeds remaining source invoice amount'; end if;
  end if;

  select coalesce(sum(case when expense.document_kind = 'credit_note' then -expense.amount else expense.amount end), 0)
    into active_net
    from public.service_purchase_request_expenses expense
    where expense.purchase_request_id = p_request_id and expense.status = 'active';
  if document_kind_value = 'invoice' and active_net + p_amount > request_row.requested_amount then
    raise exception using errcode = '23514', message = 'active expenses exceed PR ceiling';
  end if;

  insert into public.service_purchase_request_expenses(
    purchase_request_id, expense_date, amount, invoice_number, note, frequency,
    document_kind, source_expense_id, created_by, updated_by
  )
  values (
    p_request_id, p_expense_date, p_amount, invoice_number_value,
    nullif(btrim(coalesce(p_note, '')), ''), frequency_value,
    document_kind_value, p_source_expense_id, p_actor_id, p_actor_id
  )
  returning * into expense_row;

  insert into public.service_purchase_request_expense_audits(
    expense_id, purchase_request_id, action, before_data, after_data, actor_id
  )
  values (expense_row.id, p_request_id, 'created', null, to_jsonb(expense_row), p_actor_id);

  if (plan_row.requires_contract or not plan_row.is_red_cross) then
    perform public.close_service_purchase_request_po(
      p_actor_id, p_request_id,
      'ปิด PO อัตโนมัติหลังบันทึกค่าใช้จ่าย'
    );
  end if;
  return expense_row;
end
$function$;
revoke execute on function public.record_service_purchase_request_expense(uuid, uuid, date, numeric, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_service_purchase_request_expense(uuid, uuid, date, numeric, text, text, text, uuid) to service_role;

create or replace function public.update_service_purchase_request_expense(
  p_actor_id uuid, p_expense_id uuid, p_expense_date date, p_amount numeric,
  p_invoice_number text default null, p_note text default null, p_reason text default null
)
returns public.service_purchase_request_expenses language plpgsql security invoker set search_path = '' as $function$
declare
  expense_row public.service_purchase_request_expenses%rowtype;
  source_row public.service_purchase_request_expenses%rowtype;
  before_data jsonb;
  request_row public.service_purchase_requests%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  active_net numeric(17,2);
  credited_total numeric(17,2);
  source_remaining numeric(17,2);
  request_id uuid;
  invoice_number_value text := nullif(btrim(coalesce(p_invoice_number, '')), '');
begin
  select expense.purchase_request_id into request_id from public.service_purchase_request_expenses expense where expense.id = p_expense_id;
  if request_id is null then raise exception using errcode = '23503', message = 'service expense not found'; end if;
  select * into request_row from public.service_purchase_requests where id = request_id for update;
  select expense.* into expense_row from public.service_purchase_request_expenses expense where expense.id = p_expense_id for update;
  if request_row.plan_id is null then raise exception using errcode = '55000', message = 'service expense must reference a plan'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if not found or plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot edit expense'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.status <> 'confirmed' or expense_row.status <> 'active' then raise exception using errcode = '55000', message = 'closed or cancelled service expense cannot be edited'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception using errcode = '23514', message = 'expense edit requires a reason'; end if;
  if p_expense_date is null or p_expense_date < request_row.usage_start_date or p_expense_date > request_row.usage_end_date or p_amount is null or p_amount <= 0 then raise exception using errcode = '22023', message = 'expense date or amount is invalid'; end if;
  if expense_row.document_kind = 'credit_note' and invoice_number_value is null then raise exception using errcode = '23514', message = 'credit note number is required'; end if;

  perform 1 from public.service_purchase_request_expenses expense where expense.purchase_request_id = request_row.id for update;
  if expense_row.document_kind = 'credit_note' then
    select * into source_row
      from public.service_purchase_request_expenses source
      where source.id = expense_row.source_expense_id and source.purchase_request_id = request_row.id
      for update;
    if not found or source_row.status <> 'active' or source_row.document_kind <> 'invoice' then
      raise exception using errcode = '23503', message = 'credit note source invoice not found or inactive';
    end if;
    select coalesce(sum(credit.amount), 0)
      into credited_total
      from public.service_purchase_request_expenses credit
      where credit.purchase_request_id = request_row.id
        and credit.source_expense_id = source_row.id
        and credit.document_kind = 'credit_note'
        and credit.status = 'active'
        and credit.id <> p_expense_id;
    source_remaining := source_row.amount - credited_total;
    if p_amount > source_remaining then raise exception using errcode = '23514', message = 'credit note exceeds remaining source invoice amount'; end if;
  else
    select coalesce(sum(credit.amount), 0)
      into credited_total
      from public.service_purchase_request_expenses credit
      where credit.purchase_request_id = request_row.id
        and credit.source_expense_id = expense_row.id
        and credit.document_kind = 'credit_note'
        and credit.status = 'active';
    if credited_total > p_amount then raise exception using errcode = '23514', message = 'invoice cannot be reduced below active credit notes'; end if;
  end if;

  select coalesce(sum(case when expense.document_kind = 'credit_note' then -expense.amount else expense.amount end), 0)
    into active_net
    from public.service_purchase_request_expenses expense
    where expense.purchase_request_id = request_row.id and expense.status = 'active' and expense.id <> p_expense_id;
  if expense_row.document_kind = 'invoice' and active_net + p_amount > request_row.requested_amount then
    raise exception using errcode = '23514', message = 'active expenses exceed PR ceiling';
  end if;

  before_data := to_jsonb(expense_row);
  update public.service_purchase_request_expenses
  set expense_date = p_expense_date, amount = p_amount, invoice_number = invoice_number_value,
      note = nullif(btrim(coalesce(p_note, '')), ''), updated_by = p_actor_id
  where id = p_expense_id
  returning * into expense_row;
  insert into public.service_purchase_request_expense_audits(expense_id, purchase_request_id, action, before_data, after_data, reason, actor_id)
  values (expense_row.id, request_row.id, 'updated', before_data, to_jsonb(expense_row), btrim(p_reason), p_actor_id);
  return expense_row;
end
$function$;
revoke execute on function public.update_service_purchase_request_expense(uuid, uuid, date, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.update_service_purchase_request_expense(uuid, uuid, date, numeric, text, text, text) to service_role;

create or replace function public.cancel_service_purchase_request_expense(p_actor_id uuid, p_expense_id uuid, p_reason text)
returns public.service_purchase_request_expenses language plpgsql security invoker set search_path = '' as $function$
declare
  expense_row public.service_purchase_request_expenses%rowtype;
  before_data jsonb;
  request_row public.service_purchase_requests%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  request_id uuid;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception using errcode = '23514', message = 'expense cancellation requires a reason'; end if;
  select expense.purchase_request_id into request_id from public.service_purchase_request_expenses expense where expense.id = p_expense_id;
  if request_id is null then raise exception using errcode = '23503', message = 'service expense not found'; end if;
  select * into request_row from public.service_purchase_requests where id = request_id for update;
  select expense.* into expense_row from public.service_purchase_request_expenses expense where expense.id = p_expense_id for update;
  if request_row.plan_id is null then raise exception using errcode = '55000', message = 'service expense must reference a plan'; end if;
  select * into plan_row from public.service_procurement_plans where id = request_row.plan_id for update;
  if not found or plan_row.status = 'closed' then raise exception using errcode = '55000', message = 'closed service plans cannot cancel expense'; end if;
  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.status <> 'confirmed' or expense_row.status <> 'active' then raise exception using errcode = '55000', message = 'closed or cancelled service expense cannot be cancelled'; end if;
  perform 1 from public.service_purchase_request_expenses expense where expense.purchase_request_id = request_row.id for update;
  if expense_row.document_kind = 'invoice' and exists (
    select 1 from public.service_purchase_request_expenses credit
    where credit.purchase_request_id = request_row.id
      and credit.source_expense_id = expense_row.id
      and credit.document_kind = 'credit_note'
      and credit.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'invoice with active credit notes cannot be cancelled';
  end if;
  before_data := to_jsonb(expense_row);
  update public.service_purchase_request_expenses
  set status = 'cancelled', cancelled_by = p_actor_id, cancelled_at = now(), updated_by = p_actor_id
  where id = p_expense_id
  returning * into expense_row;
  insert into public.service_purchase_request_expense_audits(expense_id, purchase_request_id, action, before_data, after_data, reason, actor_id)
  values (expense_row.id, request_row.id, 'cancelled', before_data, to_jsonb(expense_row), btrim(p_reason), p_actor_id);
  return expense_row;
end
$function$;
revoke execute on function public.cancel_service_purchase_request_expense(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_service_purchase_request_expense(uuid, uuid, text) to service_role;

commit;
