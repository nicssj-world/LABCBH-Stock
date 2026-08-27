-- The service PR RPC declared a PL/pgSQL variable named line and reused that
-- name as the JSON-array alias in its amount query. PostgreSQL resolves the
-- reference as ambiguous when the RPC is first executed. Rebuild the current
-- definition with distinct names while preserving its body, owner, grants,
-- and security mode.
begin;

do $migration$
declare
  definition text;
  fixed_definition text;
begin
  select pg_get_functiondef(
    'public.create_service_purchase_request(uuid, jsonb)'::regprocedure
  )
  into definition;

  if position('  line jsonb;' in definition) = 0 then
    raise exception 'create_service_purchase_request definition does not contain the expected line variable';
  end if;

  fixed_definition := replace(
    definition,
    '  line jsonb;',
    '  line_payload jsonb;'
  );
  fixed_definition := replace(
    fixed_definition,
    'select round(coalesce(sum((line ->> ''requestedQuantity'')::numeric * (line ->> ''unitPrice'')::numeric), 0), 2)',
    'select round(coalesce(sum((item_payload ->> ''requestedQuantity'')::numeric * (item_payload ->> ''unitPrice'')::numeric), 0), 2)'
  );
  fixed_definition := replace(
    fixed_definition,
    'from jsonb_array_elements(p_payload -> ''items'') line;',
    'from jsonb_array_elements(p_payload -> ''items'') item_payload;'
  );
  fixed_definition := replace(
    fixed_definition,
    'for line in select * from jsonb_array_elements(coalesce(p_payload -> ''items'', ''[]''::jsonb)) loop',
    'for line_payload in select * from jsonb_array_elements(coalesce(p_payload -> ''items'', ''[]''::jsonb)) loop'
  );
  fixed_definition := replace(
    fixed_definition,
    'line ->>',
    'line_payload ->>'
  );

  if position('  line jsonb;' in fixed_definition) > 0
     or position('from jsonb_array_elements(p_payload -> ''items'') line;' in fixed_definition) > 0
     or position('for line in select * from jsonb_array_elements' in fixed_definition) > 0
     or position('line ->>' in fixed_definition) > 0
     or position('item_payload ->>' in fixed_definition) = 0 then
    raise exception 'failed to disambiguate create_service_purchase_request line references';
  end if;

  execute fixed_definition;
end
$migration$;

commit;
