-- Expense notes are useful context, but the PR/PO number is the required
-- audit reference. Keep the note optional at both the table and RPC layers.
alter table public.service_plan_ledger
  alter column reason drop not null;

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
  if nullif(btrim(coalesce(p_source_reference, '')), '') is null then
    raise exception using errcode = '23514', message = 'historical expense requires a source reference';
  end if;
  select * into plan_row from public.service_procurement_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = '23503', message = 'service plan not found'; end if;
  if date_trunc('month', p_expense_date)::date <> p_expense_date then
    raise exception using errcode = '22007', message = 'expense month must be the first day of the month';
  end if;
  if date_trunc('month', p_expense_date)::date > date_trunc('month', (timezone('Asia/Bangkok', now()))::date)::date then
    raise exception using errcode = '22023', message = 'expense month cannot be in the future';
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
    p_plan_id,
    'historical_expense',
    p_amount,
    p_expense_date,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    p_actor_id
  ) returning * into entry;
  return entry;
end
$function$;

revoke execute on function public.record_service_plan_historical_expense(uuid, uuid, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.record_service_plan_historical_expense(uuid, uuid, numeric, date, text, text) to service_role;
