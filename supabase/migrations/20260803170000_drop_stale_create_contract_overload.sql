-- 20260803120000_contract_start_immediately.sql added a 5th parameter
-- (p_contract_number text default null) to create_contract via `create or
-- replace function`, expecting it to replace the existing 4-argument
-- function. It did not: Postgres identifies a function by name plus its
-- argument *type list*, and adding an argument (even a defaulted one) changes
-- that list, so `create or replace` created a second, distinct overload
-- instead of replacing the first. The stale 4-argument create_contract was
-- left behind untouched.
--
-- Every 4-argument call site (confirm_purchase_request calling it with
-- exactly p_actor_id/p_contract/p_items/p_effective_date) then became
-- ambiguous: Postgres cannot tell whether that call means the true 4-argument
-- function or the 5-argument one with its last parameter defaulted, and
-- refuses with "is not unique". Dropping the stale overload leaves only the
-- 5-argument function, which every existing call site already satisfies
-- (either passing 4 positional args, relying on the default, or passing all
-- 5 by name).
begin;

drop function if exists public.create_contract(uuid, jsonb, jsonb, date);

commit;
