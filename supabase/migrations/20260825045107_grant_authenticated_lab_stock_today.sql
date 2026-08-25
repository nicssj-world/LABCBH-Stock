begin;

-- The requisition availability view is security_invoker and is queried by
-- authenticated users. Keep the view RLS-scoped while allowing its harmless
-- Bangkok business-date helper to execute for the caller.
grant execute on function public.lab_stock_today() to authenticated;

commit;
