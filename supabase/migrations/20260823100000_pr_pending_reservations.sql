begin;

-- A pending PR is a reservation even though it does not become a committed
-- contract allocation until a stock officer confirms it. The index keeps the
-- reservation check cheap while the contract-item row lock serializes creates,
-- edits, confirmations, and quantity changes for the same line.
create index if not exists purchase_request_items_contract_pending_idx
  on public.purchase_request_items (contract_item_id, purchase_request_id)
  where contract_item_id is not null;

create or replace function public.validate_purchase_request_item_contract_reservation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  contract_item_row public.contract_items%rowtype;
  request_status text;
  committed_quantity numeric(15,3);
  pending_quantity numeric(15,3);
begin
  if new.contract_item_id is null then
    return new;
  end if;

  -- Every reservation decision for one contract line takes the same parent
  -- lock. The pending sum below therefore sees an earlier reservation before
  -- allowing a concurrent PR to reserve the remaining quantity.
  select *
  into contract_item_row
  from public.contract_items item
  where item.id = new.contract_item_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'contract item not found';
  end if;

  select request.status
  into request_status
  from public.purchase_requests request
  where request.id = new.purchase_request_id;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  -- Completed PRs are already represented by an allocation. Only a pending
  -- line needs to reserve quantity at this table boundary.
  if request_status <> 'pending' then
    return new;
  end if;

  select coalesce(sum(allocation.quantity), 0)
  into committed_quantity
  from public.contract_item_allocations allocation
  where allocation.contract_item_id = new.contract_item_id;

  select coalesce(sum(item.requested_quantity), 0)
  into pending_quantity
  from public.purchase_request_items item
  join public.purchase_requests request on request.id = item.purchase_request_id
  where item.contract_item_id = new.contract_item_id
    and request.status = 'pending'
    and request.id <> new.purchase_request_id;

  if committed_quantity + pending_quantity + new.requested_quantity > contract_item_row.quantity then
    raise exception using
      errcode = '23514',
      message = 'purchase request quantity exceeds contract remaining after pending reservations';
  end if;

  return new;
end
$function$;

revoke execute on function public.validate_purchase_request_item_contract_reservation() from public, anon, authenticated;

drop trigger if exists purchase_request_items_contract_reservation
  on public.purchase_request_items;
create trigger purchase_request_items_contract_reservation
before insert or update of purchase_request_id, contract_item_id, requested_quantity
on public.purchase_request_items
for each row execute function public.validate_purchase_request_item_contract_reservation();

-- Contract edits must not reduce a line below quantity already committed or
-- reserved by pending PRs. The original guard only covered committed rows.
create or replace function public.guard_contract_item_pending_quantity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  committed_quantity numeric(15,3);
  pending_quantity numeric(15,3);
begin
  select coalesce(sum(allocation.quantity), 0)
  into committed_quantity
  from public.contract_item_allocations allocation
  where allocation.contract_item_id = old.id;

  select coalesce(sum(item.requested_quantity), 0)
  into pending_quantity
  from public.purchase_request_items item
  join public.purchase_requests request on request.id = item.purchase_request_id
  where item.contract_item_id = old.id
    and request.status = 'pending';

  if new.quantity < committed_quantity + pending_quantity then
    raise exception using
      errcode = '23514',
      message = 'contract item quantity cannot be below committed or pending reservations';
  end if;

  return new;
end
$function$;

revoke execute on function public.guard_contract_item_pending_quantity() from public, anon, authenticated;

drop trigger if exists contract_items_guard_pending_quantity on public.contract_items;
create trigger contract_items_guard_pending_quantity
before update of quantity on public.contract_items
for each row execute function public.guard_contract_item_pending_quantity();

commit;
