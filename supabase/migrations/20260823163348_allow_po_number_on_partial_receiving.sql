begin;

-- A PR can still be missing its PO number after the first partial receipt.
-- Keep the same audited RPC available until the receiving lifecycle is terminal.
create or replace function public.set_purchase_order_number(
  p_pr_id uuid,
  p_actor_id uuid,
  p_po_number text
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

  if nullif(btrim(coalesce(p_po_number, '')), '') is null then
    raise exception using errcode = '23514', message = 'purchase order number is required';
  end if;

  update public.purchase_requests
  set po_number = btrim(p_po_number),
      updated_by = p_actor_id
  where id = p_pr_id
    and status in ('completed', 'partially_received')
  returning * into updated_request;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'only a confirmed or partially received purchase request can record a purchase order number';
  end if;

  return updated_request;
end
$function$;

revoke execute on function public.set_purchase_order_number(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_purchase_order_number(uuid, uuid, text)
  to service_role;

commit;
