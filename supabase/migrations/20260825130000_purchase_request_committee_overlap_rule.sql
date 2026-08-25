-- The specification and inspection committees may share a person. The result
-- committee and inspection committee must remain disjoint.
--
-- The checklist migration contains the canonical function bodies. This
-- follow-up also repairs databases where that migration has already run,
-- without duplicating the long checklist RPC implementations here.
begin;

do $migration$
declare
  function_oid oid;
  function_definition text;
  matched_function_count integer;
  old_clause constant text := 'other.committee_kind in (''specification'', ''result'')';
  new_clause constant text := 'other.committee_kind = ''result''';
  old_message constant text := 'inspection committee cannot overlap specification or result committees';
  new_message constant text := 'result committee cannot overlap inspection committee';
  changed boolean;
begin
  select count(*)
  into matched_function_count
  from pg_proc proc
  where proc.oid in (
    'public.apply_purchase_request_checklist(uuid, uuid, uuid, jsonb, jsonb, boolean)'::regprocedure,
    'public.set_contract_committees(bigint, uuid, jsonb)'::regprocedure
  );
  if matched_function_count <> 2 then
    raise exception using errcode = '42809', message = 'committee overlap RPCs are missing';
  end if;

  for function_oid in
    select proc.oid
    from pg_proc proc
    where proc.oid in (
      'public.apply_purchase_request_checklist(uuid, uuid, uuid, jsonb, jsonb, boolean)'::regprocedure,
      'public.set_contract_committees(bigint, uuid, jsonb)'::regprocedure
    )
  loop
    function_definition := pg_get_functiondef(function_oid);
    changed := false;

    if position(old_clause in function_definition) > 0 then
      function_definition := replace(function_definition, old_clause, new_clause);
      changed := true;
    elsif position(new_clause in function_definition) = 0 then
      raise exception using errcode = '42809', message = 'committee overlap rule is not recognized';
    end if;

    if position(old_message in function_definition) > 0 then
      function_definition := replace(function_definition, old_message, new_message);
      changed := true;
    elsif position(new_message in function_definition) = 0 then
      raise exception using errcode = '42809', message = 'committee overlap error message is not recognized';
    end if;

    if changed then
      execute rtrim(function_definition, E';\n\r\t ');
    end if;
  end loop;
end
$migration$;

commit;
