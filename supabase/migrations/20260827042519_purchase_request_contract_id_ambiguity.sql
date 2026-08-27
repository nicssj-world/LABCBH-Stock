-- Production migration version 20260827042519. The contract checklist RPCs used a PL/pgSQL variable named contract_id next
-- to queries that also expose a contract_id column.  PostgreSQL resolves that
-- reference as ambiguous in production.  Rebuild the two current function
-- definitions with a distinct variable name while preserving their existing
-- body, owner, grants, and security mode.
begin;

do $migration$
declare
  checklist_definition text;
  contract_file_definition text;
begin
  select pg_get_functiondef(
    'public.apply_purchase_request_checklist(uuid, uuid, uuid, jsonb, jsonb, boolean)'::regprocedure
  )
  into checklist_definition;

  if position('  contract_id bigint;' in checklist_definition) = 0 then
    raise exception 'apply_purchase_request_checklist definition does not contain the expected contract_id variable';
  end if;

  checklist_definition := replace(
    checklist_definition,
    '  contract_id bigint;',
    '  contract_id_value bigint;'
  );
  checklist_definition := replace(
    checklist_definition,
    '    contract_id := nullif(',
    '    contract_id_value := nullif('
  );
  checklist_definition := replace(
    checklist_definition,
    'committee.contract_id = contract_id',
    'committee.contract_id = contract_id_value'
  );
  checklist_definition := replace(
    checklist_definition,
    'committee.name_snapshot, committee.position_snapshot, contract_id',
    'committee.name_snapshot, committee.position_snapshot, contract_id_value'
  );

  if position('committee.contract_id = contract_id ' in checklist_definition) > 0
     or position('committee.contract_id = contract_id;' in checklist_definition) > 0 then
    raise exception 'failed to disambiguate apply_purchase_request_checklist contract_id references';
  end if;

  execute checklist_definition;

  select pg_get_functiondef(
    'public.apply_purchase_request_checklist_with_contract_file(uuid, uuid, uuid, jsonb, jsonb, boolean)'::regprocedure
  )
  into contract_file_definition;

  if position('  contract_id bigint;' in contract_file_definition) = 0 then
    raise exception 'apply_purchase_request_checklist_with_contract_file definition does not contain the expected contract_id variable';
  end if;

  contract_file_definition := replace(
    contract_file_definition,
    '  contract_id bigint;',
    '  contract_id_value bigint;'
  );
  contract_file_definition := replace(
    contract_file_definition,
    '    contract_id := nullif(',
    '    contract_id_value := nullif('
  );
  contract_file_definition := replace(
    contract_file_definition,
    '  if contract_id is null then',
    '  if contract_id_value is null then'
  );
  contract_file_definition := replace(
    contract_file_definition,
    'where contract.id = contract_id',
    'where contract.id = contract_id_value'
  );
  contract_file_definition := replace(
    contract_file_definition,
    'contract_id::text',
    'contract_id_value::text'
  );
  contract_file_definition := replace(
    contract_file_definition,
    'attachment.source_contract_id = contract_id',
    'attachment.source_contract_id = contract_id_value'
  );
  contract_file_definition := replace(
    contract_file_definition,
    '      contract_id' || chr(13) || chr(10) || '    )',
    '      contract_id_value' || chr(13) || chr(10) || '    )'
  );
  contract_file_definition := replace(
    contract_file_definition,
    '      contract_id' || chr(10) || '    )',
    '      contract_id_value' || chr(10) || '    )'
  );
  contract_file_definition := replace(
    contract_file_definition,
    '      contract_id,' || chr(13) || chr(10) || '      source_attachment_id,',
    '      contract_id_value,' || chr(13) || chr(10) || '      source_attachment_id,'
  );
  contract_file_definition := replace(
    contract_file_definition,
    '      contract_id,' || chr(10) || '      source_attachment_id,',
    '      contract_id_value,' || chr(10) || '      source_attachment_id,'
  );

  if (strpos(contract_file_definition, 'where contract.id = contract_id' || chr(13) || chr(10)) > 0
      or strpos(contract_file_definition, 'where contract.id = contract_id' || chr(10)) > 0)
     or (strpos(contract_file_definition, 'attachment.source_contract_id = contract_id' || chr(13) || chr(10)) > 0
         or strpos(contract_file_definition, 'attachment.source_contract_id = contract_id' || chr(10)) > 0)
     or position('contract_id::text' in contract_file_definition) > 0 then
    raise exception 'failed to disambiguate shared contract file contract_id references';
  end if;

  execute contract_file_definition;
end
$migration$;

commit;
