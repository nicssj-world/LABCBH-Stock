begin;

alter view public.vw_kpi_dashboard
  set (security_invoker = true);

revoke all on public.vw_kpi_dashboard from anon;
revoke all on public.vw_kpi_dashboard from authenticated;
revoke all on public.vw_kpi_dashboard from service_role;

grant select on public.vw_kpi_dashboard to authenticated;
grant select on public.vw_kpi_dashboard to service_role;

commit;
