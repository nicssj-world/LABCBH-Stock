-- 20260803150000_pr_lease_origination.sql taught create_purchase_request and
-- confirm_purchase_request about the 'equipment_lease' method, but missed the
-- table-level check constraint on purchase_requests.purchase_method itself,
-- which still only allowed the original six values. Every insert of a lease
-- PR was rejected by the database before the RPC's own logic ever mattered.
begin;

alter table public.purchase_requests
  drop constraint purchase_requests_purchase_method_check;

alter table public.purchase_requests
  add constraint purchase_requests_purchase_method_check
  check (purchase_method in (
    'annual_plan',
    'contract',
    'awaiting_contract',
    'off_plan',
    'specific_contract',
    'e_bidding',
    'equipment_lease'
  ));

commit;
