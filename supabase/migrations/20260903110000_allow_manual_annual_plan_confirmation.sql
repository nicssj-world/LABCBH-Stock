-- A manually selected annual-plan row is an explicit requester confirmation.
-- Keep the current-version and line-identity checks, but do not let OCR text
-- reject that selection. Automatic name matches remain text-validated.
do $migration$
declare
  function_definition text;
  contract_guard text := $needle$if not public.annual_plan_text_is_related(contract_name, plan_row.item_name, plan_row.raw_text) then$needle$;
  manual_guard text := $needle$if match_method = 'manual_confirmed'
         and not public.annual_plan_text_is_related(actual_item_name, plan_row.item_name, plan_row.raw_text)
         and (
           actual_item_ls_code is null
           or plan_row.ls_code is null
           or upper(regexp_replace(actual_item_ls_code, '[^a-zA-Z0-9]', '', 'g'))
              <> upper(regexp_replace(plan_row.ls_code, '[^a-zA-Z0-9]', '', 'g'))
         ) then
        raise exception using errcode = '23514', message = 'annual plan row is not related to the catalogue item';
      end if;$needle$;
begin
  select pg_get_functiondef(
    'public.apply_purchase_request_annual_plan_reference(uuid, uuid, jsonb)'::regprocedure
  )
  into function_definition;

  if position(contract_guard in function_definition) = 0
     or position(manual_guard in function_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'annual plan reference function body changed; manual confirmation migration must be reviewed';
  end if;

  function_definition := replace(
    function_definition,
    contract_guard,
    $replacement$if contract_match_method = 'name_exact'
       and not public.annual_plan_text_is_related(contract_name, plan_row.item_name, plan_row.raw_text) then$replacement$
  );
  function_definition := replace(
    function_definition,
    manual_guard,
    $replacement$-- Manual confirmation is the requester's explicit row selection.
      null;$replacement$
  );

  execute function_definition;
end;
$migration$;
