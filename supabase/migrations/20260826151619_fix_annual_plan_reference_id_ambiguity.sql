-- Fix the annual-plan PR reference function without editing the migration that
-- originally created it. The PL/pgSQL variable name must not collide with the
-- reference_id column used by the line-reference query.
create or replace function public.apply_purchase_request_annual_plan_reference(
  p_pr_id uuid,
  p_actor_id uuid,
  p_reference jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_request public.purchase_requests%rowtype;
  plan_version public.lab_stock_annual_plan_versions%rowtype;
  plan_pointer public.lab_stock_annual_plans%rowtype;
  generated_attachment_id uuid;
  v_reference_id uuid;
  source_checksum text;
  plan_fiscal_year integer;
  plan_version_id uuid;
  current_fiscal_year integer;
  reference_line jsonb;
  item_row public.purchase_request_items%rowtype;
  plan_row public.lab_stock_annual_plan_rows%rowtype;
  reference_index integer := 0;
  plan_row_id uuid;
  plan_line_number integer;
  match_method text;
  expected_item_count integer;
  actual_item_name text;
  actual_item_ls_code text;
  expected_plan_type text;
  contract_reference jsonb;
  contract_name text;
  contract_plan_row_id uuid;
  contract_plan_line_number integer;
  contract_match_method text;
  actual_contract_name text;
begin
  select request.* into target_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'purchase request not found'; end if;
  perform public.assert_purchase_request_manager(p_actor_id, target_request.requester_id);

  if p_reference is null then
    if target_request.purchase_method in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease') then
      raise exception using errcode = '23514', message = 'annual-plan purchase requests need a plan reference';
    end if;
    delete from public.purchase_request_annual_plan_references reference
    where reference.purchase_request_id = p_pr_id;
    update public.purchase_requests
    set annual_plan_reference_required = false, updated_by = p_actor_id
    where id = p_pr_id;
    return jsonb_build_object('id', p_pr_id, 'referenced', false);
  end if;
  if target_request.purchase_method not in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease') then
    raise exception using errcode = '23514', message = 'annual plan reference is not supported for this purchase method';
  end if;
  expected_plan_type := case when target_request.purchase_method = 'equipment_lease' then 'hiring' else 'procurement' end;
  if jsonb_typeof(p_reference) <> 'object'
     or jsonb_typeof(p_reference -> 'lines') <> 'array' then
    raise exception using errcode = '22023', message = 'annual plan reference is invalid';
  end if;

  current_fiscal_year := extract(year from timezone('Asia/Bangkok', now()))::integer
    + case when extract(month from timezone('Asia/Bangkok', now())) >= 10 then 544 else 543 end;
  if (
    extract(year from target_request.requested_date)::integer
    + case when extract(month from target_request.requested_date) >= 10 then 544 else 543 end
  ) <> current_fiscal_year then
    raise exception using errcode = '22023', message = 'annual-plan purchase request date must be in the current fiscal year';
  end if;

  begin
    plan_fiscal_year := (p_reference ->> 'planFiscalYear')::integer;
    plan_version_id := (p_reference ->> 'planVersionId')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'annual plan reference identifiers are invalid';
  end;
  if (p_reference ->> 'planType') is distinct from expected_plan_type then
    raise exception using errcode = '23514', message = 'annual plan type does not match the purchase method';
  end if;
  if plan_fiscal_year is distinct from current_fiscal_year then
    raise exception using errcode = '22023', message = 'annual plan reference is not for the current fiscal year';
  end if;

  select * into plan_pointer
  from public.lab_stock_annual_plans plan
  where plan.fiscal_year = current_fiscal_year and plan.plan_type = expected_plan_type
  for update;
  if not found or plan_pointer.current_version_id is null
     or plan_pointer.current_version_id is distinct from plan_version_id then
    raise exception using errcode = '55000', message = 'annual plan file changed; rematch the PR lines';
  end if;
  select * into plan_version
  from public.lab_stock_annual_plan_versions version
  where version.id = plan_pointer.current_version_id
    and version.fiscal_year = current_fiscal_year
    and version.plan_type = expected_plan_type
    and version.index_status = 'ready';
  if not found then raise exception using errcode = '55000', message = 'annual plan index is not ready'; end if;
  source_checksum := plan_version.source_checksum;

  select count(*) into expected_item_count
  from public.purchase_request_items item
  where item.purchase_request_id = p_pr_id;
  if expected_plan_type = 'procurement' and jsonb_array_length(p_reference -> 'lines') <> expected_item_count then
    raise exception using errcode = '23514', message = 'annual plan reference line count does not match the PR';
  end if;
  if expected_plan_type = 'hiring' then
    if expected_item_count <> 0 or jsonb_array_length(p_reference -> 'lines') <> 0 then
      raise exception using errcode = '23514', message = 'hiring-plan lease requests cannot contain purchase item references';
    end if;
    contract_reference := p_reference -> 'contract';
    if jsonb_typeof(contract_reference) <> 'object' then
      raise exception using errcode = '22023', message = 'hiring plan reference must contain a contract name';
    end if;
    contract_name := nullif(btrim(contract_reference ->> 'contractName'), '');
    actual_contract_name := nullif(btrim(target_request.method_details -> 'contractDraft' ->> 'displayName'), '');
    if contract_name is null or actual_contract_name is null
       or lower(regexp_replace(contract_name, '\s+', ' ', 'g'))
          <> lower(regexp_replace(actual_contract_name, '\s+', ' ', 'g')) then
      raise exception using errcode = '23514', message = 'hiring plan contract name does not match the PR';
    end if;
    begin
      contract_plan_row_id := (contract_reference -> 'line' ->> 'planRowId')::uuid;
      contract_plan_line_number := (contract_reference -> 'line' ->> 'lineNumber')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'hiring plan contract row reference is invalid';
    end;
    contract_match_method := contract_reference -> 'line' ->> 'matchMethod';
    if contract_plan_row_id is null or contract_plan_line_number is null
        or contract_plan_line_number < 1
        or contract_match_method is null
        or contract_match_method not in ('name_exact', 'manual_confirmed') then
      raise exception using errcode = '22023', message = 'hiring plan contract row reference is invalid';
    end if;
    select row.* into plan_row
    from public.lab_stock_annual_plan_rows row
    where row.id = contract_plan_row_id
      and row.annual_plan_version_id = plan_version.id
      and row.line_number = contract_plan_line_number;
    if not found then
      raise exception using errcode = '23503', message = 'hiring plan row is not part of the current version';
    end if;
    if position(lower(regexp_replace(contract_name, '\s+', ' ', 'g')) in lower(regexp_replace(plan_row.item_name, '\s+', ' ', 'g'))) = 0
       and position(lower(regexp_replace(plan_row.item_name, '\s+', ' ', 'g')) in lower(regexp_replace(contract_name, '\s+', ' ', 'g'))) = 0
       and position(lower(regexp_replace(contract_name, '\s+', ' ', 'g')) in lower(regexp_replace(plan_row.raw_text, '\s+', ' ', 'g'))) = 0 then
      raise exception using errcode = '23514', message = 'hiring plan row is not related to the contract name';
    end if;
  end if;

  select attachment.id into generated_attachment_id
  from public.purchase_request_attachments attachment
  join public.purchase_request_upload_tickets upload on upload.id = attachment.upload_ticket_id
  where attachment.purchase_request_id = p_pr_id
    and attachment.attachment_kind = 'plan_page'
    and attachment.slot = 1
    and attachment.deleted_at is null
    and attachment.generated_by_system
    and attachment.annual_plan_version_id = plan_version.id
    and upload.generated_by_system
    and upload.annual_plan_version_id = plan_version.id
  order by attachment.uploaded_at desc
  limit 1;
  if generated_attachment_id is null then
    raise exception using errcode = '23514', message = 'annual plan highlight evidence is required';
  end if;

  delete from public.purchase_request_annual_plan_references reference
  where reference.purchase_request_id = p_pr_id;
  insert into public.purchase_request_annual_plan_references (
    purchase_request_id, plan_version_id, plan_fiscal_year, plan_type, source_checksum,
    generated_attachment_id, contract_name_snapshot, contract_plan_row_id,
    contract_plan_line_number, contract_match_method, created_by
  ) values (
    p_pr_id, plan_version.id, current_fiscal_year, expected_plan_type, source_checksum,
    generated_attachment_id, contract_name, contract_plan_row_id,
    contract_plan_line_number, contract_match_method, p_actor_id
  ) returning id into v_reference_id;

  if expected_plan_type = 'procurement' then
    for item_row in
    select item.*
    from public.purchase_request_items item
    where item.purchase_request_id = p_pr_id
    order by item.line_number
    loop
      reference_index := reference_index + 1;
      reference_line := p_reference -> 'lines' -> (reference_index - 1);
      begin
        plan_row_id := (reference_line ->> 'planRowId')::uuid;
        plan_line_number := (reference_line ->> 'lineNumber')::integer;
      exception when others then
        raise exception using errcode = '22023', message = 'annual plan line reference is invalid';
      end;
      match_method := reference_line ->> 'matchMethod';
      if match_method is null or match_method not in ('name_exact', 'code_exact', 'manual_confirmed') then
        raise exception using errcode = '22023', message = 'annual plan match method is invalid';
      end if;
      select row.* into plan_row
      from public.lab_stock_annual_plan_rows row
      where row.id = plan_row_id and row.annual_plan_version_id = plan_version.id
        and row.line_number = plan_line_number;
      if not found then
        raise exception using errcode = '23503', message = 'annual plan row is not part of the current version';
      end if;

    -- The PR payload is client input. Re-read the catalogue identity created
    -- or selected by the base PR RPC before accepting a plan match, including
    -- for a newly-created catalogue line.
      select inventory_item.name, inventory_item.ls_code
      into actual_item_name, actual_item_ls_code
      from public.inventory_items inventory_item
      where inventory_item.id = item_row.inventory_item_id;
      if not found then
        raise exception using errcode = '23503', message = 'purchase request inventory item is not available';
      end if;

      if match_method = 'name_exact'
         and position(lower(btrim(actual_item_name)) in lower(plan_row.item_name)) = 0
         and position(lower(btrim(plan_row.item_name)) in lower(actual_item_name)) = 0
         and position(lower(btrim(actual_item_name)) in lower(plan_row.raw_text)) = 0 then
        raise exception using errcode = '23514', message = 'annual plan name does not match the catalogue item';
      end if;
      if match_method = 'name_exact'
         and actual_item_ls_code is not null
         and plan_row.ls_code is not null
         and upper(regexp_replace(actual_item_ls_code, '[^a-zA-Z0-9]', '', 'g'))
             <> upper(regexp_replace(plan_row.ls_code, '[^a-zA-Z0-9]', '', 'g')) then
        raise exception using errcode = '23514', message = 'annual plan LS code does not confirm the catalogue item';
      end if;
      if match_method = 'code_exact'
         and (
           actual_item_ls_code is null
           or upper(regexp_replace(actual_item_ls_code, '[^a-zA-Z0-9]', '', 'g'))
              <> upper(regexp_replace(coalesce(plan_row.ls_code, ''), '[^a-zA-Z0-9]', '', 'g'))
         ) then
        raise exception using errcode = '23514', message = 'annual plan LS code does not match the catalogue item';
      end if;
      if match_method = 'manual_confirmed'
         and position(lower(btrim(actual_item_name)) in lower(plan_row.item_name)) = 0
         and position(lower(btrim(plan_row.item_name)) in lower(actual_item_name)) = 0
         and position(lower(btrim(actual_item_name)) in lower(plan_row.raw_text)) = 0
         and (
           actual_item_ls_code is null
           or plan_row.ls_code is null
           or upper(regexp_replace(actual_item_ls_code, '[^a-zA-Z0-9]', '', 'g'))
              <> upper(regexp_replace(plan_row.ls_code, '[^a-zA-Z0-9]', '', 'g'))
         ) then
        raise exception using errcode = '23514', message = 'annual plan row is not related to the catalogue item';
      end if;
      insert into public.purchase_request_annual_plan_line_references (
        reference_id, purchase_request_item_id, plan_row_id, plan_line_number, match_method
      ) values (
        v_reference_id, item_row.id, plan_row.id, plan_row.line_number, match_method
      );
    end loop;
  end if;

  if expected_plan_type = 'procurement' then
    update public.purchase_requests request
    set annual_plan_reference_required = true,
        method_details = jsonb_set(
          jsonb_set(request.method_details, '{fiscalYear}', to_jsonb(current_fiscal_year), true),
          '{planSequence}',
          to_jsonb((
            select string_agg(row.plan_sequence, ', ' order by item.line_number)
            from public.purchase_request_annual_plan_line_references reference_line
            join public.purchase_request_items item on item.id = reference_line.purchase_request_item_id
            join public.lab_stock_annual_plan_rows row on row.id = reference_line.plan_row_id
            where reference_line.reference_id = v_reference_id
          )),
          true
        ),
        updated_by = p_actor_id
    where request.id = p_pr_id;
  else
    update public.purchase_requests
    set annual_plan_reference_required = true, updated_by = p_actor_id
    where id = p_pr_id;
  end if;

  return jsonb_build_object(
    'id', p_pr_id,
    'referenced', true,
    'planVersionId', plan_version.id,
    'planFiscalYear', current_fiscal_year,
    'planType', expected_plan_type,
    'generatedAttachmentId', generated_attachment_id
  );
end
$function$;
