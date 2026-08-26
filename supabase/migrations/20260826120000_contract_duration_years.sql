-- Store the selected term for contracts originated from a purchase request.
-- Existing/directly-entered contracts may remain null because their term was
-- not recorded by the older workflow.
begin;

alter table public.contracts
  add column if not exists contract_duration_years integer;

alter table public.contracts
  drop constraint if exists contracts_contract_duration_years_check;

alter table public.contracts
  add constraint contracts_contract_duration_years_check
  check (contract_duration_years is null or contract_duration_years in (1, 3));

create index if not exists contracts_contract_duration_years_idx
  on public.contracts (contract_duration_years)
  where contract_duration_years is not null;

-- New contract-opening PRs must carry one of the supported terms. This is a
-- database boundary as well as a form validation so a direct service-role RPC
-- call cannot create a new PR that the contract register cannot classify.
create or replace function public.enforce_purchase_request_contract_duration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.purchase_method in ('specific_contract', 'e_bidding', 'equipment_lease')
     and coalesce(new.method_details #>> '{contractDraft,contractDurationYears}', '') not in ('1', '3') then
    raise exception using
      errcode = '23514',
      message = 'new contract purchase requests require a contract duration of 1 or 3 years';
  end if;
  return new;
end
$function$;

drop trigger if exists purchase_requests_contract_duration on public.purchase_requests;
create trigger purchase_requests_contract_duration
before insert or update of purchase_method, method_details
on public.purchase_requests
for each row execute function public.enforce_purchase_request_contract_duration();

-- Confirmation already creates the contract and links it back to the PR in
-- one transaction. Copy the immutable PR snapshot at that link point, so the
-- existing confirmation RPCs need no second client-visible write and legacy
-- PRs without this field continue to produce a null duration.
create or replace function public.copy_purchase_request_contract_duration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  duration_text text;
begin
  if new.created_contract_id is null or old.created_contract_id is not null then
    return new;
  end if;

  if new.purchase_method not in ('specific_contract', 'e_bidding', 'equipment_lease') then
    return new;
  end if;

  duration_text := nullif(btrim(new.method_details #>> '{contractDraft,contractDurationYears}'), '');
  if duration_text is null then
    return new;
  end if;

  if duration_text not in ('1', '3') then
    raise exception using
      errcode = '23514',
      message = 'contract duration must be 1 or 3 years';
  end if;

  update public.contracts
  set contract_duration_years = duration_text::integer
  where id = new.created_contract_id;

  if not found then
    raise exception using errcode = '23503', message = 'originated contract not found';
  end if;

  return new;
end
$function$;

drop trigger if exists purchase_requests_copy_contract_duration on public.purchase_requests;
create trigger purchase_requests_copy_contract_duration
after update of created_contract_id
on public.purchase_requests
for each row execute function public.copy_purchase_request_contract_duration();

revoke execute on function public.enforce_purchase_request_contract_duration() from public, anon, authenticated;
revoke execute on function public.copy_purchase_request_contract_duration() from public, anon, authenticated;

commit;
