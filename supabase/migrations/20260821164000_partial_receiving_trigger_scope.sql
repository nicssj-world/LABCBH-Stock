begin;

-- Contract identity is unaffected when receiving reconciles received_quantity.
-- Restrict this integrity trigger to inserts and changes to the three reference
-- columns it actually validates, so unrelated audit/cache updates do not fail
-- on legacy PR rows that predate contract departments.
drop trigger if exists purchase_request_items_contract_integrity
  on public.purchase_request_items;

create trigger purchase_request_items_contract_integrity
before insert or update of purchase_request_id, inventory_item_id, contract_item_id
on public.purchase_request_items
for each row execute function public.validate_purchase_request_item_contract();

commit;
