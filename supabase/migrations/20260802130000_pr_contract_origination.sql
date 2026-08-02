-- A purchase request can now originate a brand-new contract instead of only
-- ordering against one that already exists. "ทำสัญญาเจาะจง" and "E-Bidding"
-- stopped meaning "reference a started contract's balance" and became
-- "draft a contract for the stock officer to open". Confirming that kind of
-- PR is the single moment the contract is created — inside the same
-- transaction and under the same PR row lock as the rest of confirmation,
-- calling create_contract exactly the way "เพิ่มสัญญา" does. The contract
-- lands at stage 1 (ส่งพัสดุ) immediately; there is no interim hidden status
-- for anyone to remember to finish later.

begin;

alter table public.contracts
  add column if not exists sent_to_stock_officer_date date;

-- Lets a completed PR link forward to the contract it opened. Distinct from
-- purchase_request_items.contract_item_id, which links backward to an
-- existing contract's line for an ordinary drawdown purchase.
alter table public.purchase_requests
  add column if not exists created_contract_id bigint references public.contracts(id) on delete restrict;

create index if not exists purchase_requests_created_contract_idx
  on public.purchase_requests (created_contract_id) where created_contract_id is not null;

create or replace function public.confirm_purchase_request(
  p_pr_id uuid,
  p_actor_id uuid,
  p_sent_to_procurement_date date default null
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  confirmed_request public.purchase_requests%rowtype;
  line public.purchase_request_items%rowtype;
  contract_draft jsonb;
  contract_items jsonb;
  new_contract public.contracts%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  -- Lock first, then re-read status under the lock. Checking before locking
  -- would let two officers both see 'pending' and both act on it.
  select *
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'purchase request not found';
  end if;

  if locked_request.status <> 'pending' then
    raise exception using
      errcode = '55000',
      message = format('purchase request is %s and cannot be confirmed', locked_request.status);
  end if;

  if locked_request.purchase_method in ('specific_contract', 'e_bidding') then
    if p_sent_to_procurement_date is null then
      raise exception using
        errcode = '22004',
        message = 'sent-to-procurement date is required to open a contract from this purchase request';
    end if;

    contract_draft := locked_request.method_details -> 'contractDraft';
    if contract_draft is null then
      raise exception using errcode = '22023', message = 'purchase request is missing its contract draft';
    end if;

    -- Every line on this PR becomes a contract line. lsCode/name are read back
    -- from the inventory catalogue rather than trusted from the PR row, same
    -- as create_contract would insist on if called directly.
    select jsonb_agg(
      jsonb_build_object(
        'lsCode', inventory_item.ls_code,
        'name', inventory_item.name,
        'quantity', item.requested_quantity,
        'unit', item.unit,
        'unitPrice', item.unit_price
      )
      order by item.line_number
    )
    into contract_items
    from public.purchase_request_items item
    join public.inventory_items inventory_item on inventory_item.id = item.inventory_item_id
    where item.purchase_request_id = p_pr_id;

    -- create_contract is security invoker, called here inside the same
    -- transaction and under the same PR row lock — one atomic operation, not
    -- two RPCs a caller could interleave. The requester is the PR's own head
    -- or admin (assert_contract_editor_actor already let them submit it), so
    -- they become the contract's actor; the stock officer only supplies the
    -- date. fiscalYear/displayName/vendor are passed as jsonb (not text) so
    -- their JSON types survive unchanged into create_contract's own checks.
    select * into new_contract from public.create_contract(
      locked_request.requester_id,
      jsonb_build_object(
        'fiscalYear', contract_draft -> 'fiscalYear',
        'contractType', case locked_request.purchase_method
          when 'specific_contract' then 'specific'
          when 'e_bidding' then 'e_bidding'
        end,
        'department', locked_request.department,
        'displayName', contract_draft -> 'displayName',
        'vendor', contract_draft -> 'vendor',
        'endDate', null::text
      ),
      coalesce(contract_items, '[]'::jsonb),
      p_sent_to_procurement_date
    );

    -- sent_to_stock_officer_date is the date the requester recorded on the PR
    -- form (when they handed the request to the stock officer) — a different
    -- fact from sent_to_procurement_date, which the stock officer is entering
    -- right now via p_sent_to_procurement_date as they open the contract.
    update public.contracts
    set sent_to_stock_officer_date = (contract_draft ->> 'sentToStockOfficerDate')::date
    where id = new_contract.id;
  elsif p_sent_to_procurement_date is not null then
    raise exception using
      errcode = '22023',
      message = 'sent-to-procurement date only applies to a purchase request that opens a contract';
  end if;

  for line in
    select *
    from public.purchase_request_items item
    where item.purchase_request_id = p_pr_id
    order by item.line_number
  loop
    if line.contract_item_id is not null then
      -- validate_contract_item_allocation locks the contract item and rejects
      -- anything over the contracted quantity, so the ceiling holds even under
      -- concurrent confirmations.
      insert into public.contract_item_allocations (
        contract_item_id,
        purchase_request_item_id,
        allocation_kind,
        quantity,
        created_by
      )
      values (
        line.contract_item_id,
        line.id,
        'purchase_request',
        line.requested_quantity,
        p_actor_id
      );
    end if;
  end loop;

  update public.purchase_requests
  set status = 'completed',
      acknowledged_by = p_actor_id,
      acknowledged_at = now(),
      created_contract_id = new_contract.id,
      updated_by = p_actor_id
  where id = p_pr_id
  returning * into confirmed_request;

  return confirmed_request;
end
$function$;

-- The two-argument signature is replaced, not overloaded: nothing else in the
-- schema calls it, and leaving it behind would let a stale caller confirm a
-- contract-opening PR with no date at all.
drop function if exists public.confirm_purchase_request(uuid, uuid);

revoke execute on function public.confirm_purchase_request(uuid, uuid, date) from public;
revoke execute on function public.confirm_purchase_request(uuid, uuid, date) from anon;
revoke execute on function public.confirm_purchase_request(uuid, uuid, date) from authenticated;
grant execute on function public.confirm_purchase_request(uuid, uuid, date) to service_role;

commit;
