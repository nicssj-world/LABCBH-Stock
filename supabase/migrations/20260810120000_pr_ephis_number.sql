-- Purchase requests — a stock officer's own cross-reference to the number
-- E-Phis (the hospital's external procurement system) assigns the request.
-- Unlike po_number, this is editable in every PR status and every purchase
-- method, since the officer may log it into E-Phis before the PR is even
-- confirmed here.

begin;

alter table public.purchase_requests
  add column if not exists ephis_pr_number text;

create unique index if not exists purchase_requests_ephis_pr_number_key
  on public.purchase_requests (lower(btrim(ephis_pr_number)))
  where ephis_pr_number is not null;

create or replace function public.set_ephis_pr_number(
  p_pr_id uuid,
  p_actor_id uuid,
  p_ephis_pr_number text
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_request public.purchase_requests%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if nullif(btrim(coalesce(p_ephis_pr_number, '')), '') is null then
    raise exception using errcode = '23514', message = 'E-Phis PR number is required';
  end if;

  update public.purchase_requests
  set ephis_pr_number = btrim(p_ephis_pr_number),
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into updated_request;

  if not found then
    raise exception using errcode = '55000', message = 'purchase request not found';
  end if;

  return updated_request;
end
$function$;

revoke execute on function public.set_ephis_pr_number(uuid, uuid, text) from public;
revoke execute on function public.set_ephis_pr_number(uuid, uuid, text) from anon;
revoke execute on function public.set_ephis_pr_number(uuid, uuid, text) from authenticated;
grant execute on function public.set_ephis_pr_number(uuid, uuid, text) to service_role;

commit;
