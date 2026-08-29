begin;

-- Contract-backed service PRs are settled when their first actual expense is
-- recorded. Keep the expense insert, ledger posting, reservation release, and
-- PO state transition inside the same RPC transaction.
create or replace function public.record_service_purchase_request_expense(
  p_actor_id uuid, p_request_id uuid, p_expense_date date, p_amount numeric,
  p_invoice_number text default null, p_note text default null
)
returns public.service_purchase_request_expenses language plpgsql security invoker set search_path = '' as $function$
declare
  request_row public.service_purchase_requests%rowtype;
  plan_row public.service_procurement_plans%rowtype;
  expense_row public.service_purchase_request_expenses%rowtype;
  active_total numeric(17,2);
  frequency_value text;
begin
  select * into request_row
  from public.service_purchase_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'service purchase request not found';
  end if;

  perform public.service_procurement_assert_actor(p_actor_id, 'request_recorder', request_row.id);
  if request_row.plan_id is null then
    raise exception using errcode = '55000', message = 'service expense must reference a plan';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'expense amount must be positive';
  end if;
  if request_row.status <> 'confirmed'
    or request_row.po_status in ('closed', 'cancelled')
    or (request_row.po_number is null and request_row.po_file_path is null) then
    raise exception using errcode = '55000', message = 'service PR must be confirmed and have PO evidence before recording expense';
  end if;
  if p_expense_date < request_row.usage_start_date or p_expense_date > request_row.usage_end_date then
    raise exception using errcode = '22023', message = 'expense date must be inside PO usage range';
  end if;

  select * into plan_row
  from public.service_procurement_plans
  where id = request_row.plan_id
  for update;
  if not found or plan_row.status = 'closed' then
    raise exception using errcode = '55000', message = 'closed service plans cannot record expense';
  end if;

  frequency_value := case when plan_row.is_red_cross then 'daily' else 'monthly' end;
  select coalesce(sum(expense.amount), 0)
  into active_total
  from public.service_purchase_request_expenses expense
  where expense.purchase_request_id = p_request_id
    and expense.status = 'active';
  if active_total + p_amount > request_row.requested_amount then
    raise exception using errcode = '23514', message = 'active expenses exceed PR ceiling';
  end if;

  insert into public.service_purchase_request_expenses(
    purchase_request_id, expense_date, amount, invoice_number, note, frequency, created_by, updated_by
  )
  values (
    p_request_id,
    p_expense_date,
    p_amount,
    nullif(btrim(coalesce(p_invoice_number, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    frequency_value,
    p_actor_id,
    p_actor_id
  )
  returning * into expense_row;

  insert into public.service_purchase_request_expense_audits(
    expense_id, purchase_request_id, action, before_data, after_data, actor_id
  )
  values (expense_row.id, p_request_id, 'created', null, to_jsonb(expense_row), p_actor_id);

  -- A contract-backed PO is closed immediately after the expense is recorded.
  -- The close RPC also posts the plan expense and releases any reservation.
  if plan_row.requires_contract then
    perform public.close_service_purchase_request_po(
      p_actor_id,
      p_request_id,
      'ปิด PO อัตโนมัติหลังบันทึกค่าใช้จ่าย'
    );
  end if;

  return expense_row;
end
$function$;
revoke execute on function public.record_service_purchase_request_expense(uuid, uuid, date, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_service_purchase_request_expense(uuid, uuid, date, numeric, text, text) to service_role;

commit;
