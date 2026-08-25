begin;

-- A contract page is one shared legal document.  Keep its metadata beside the
-- canonical storage pointer so a PR can reference the same object without
-- copying it into the PR checklist bucket.
alter table public.contracts
  add column if not exists contract_file_name text,
  add column if not exists contract_file_mime_type text,
  add column if not exists contract_file_size_bytes bigint;

-- Storage is hard-deleted at contract close, but the file identity and the
-- actor who performed that deletion remain in an append-only audit surface.
create table if not exists public.contract_file_audit (
  id bigint generated always as identity primary key,
  contract_id bigint not null references public.contracts(id) on delete restrict,
  action text not null check (action in ('deleted')),
  file_url text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  actor_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists contract_file_audit_contract_idx
  on public.contract_file_audit (contract_id, created_at desc);

drop trigger if exists contract_file_audit_append_only on public.contract_file_audit;
create trigger contract_file_audit_append_only
before update or delete on public.contract_file_audit
for each row execute function public.prevent_append_only_mutation();

alter table public.contract_file_audit enable row level security;
revoke all on table public.contract_file_audit from anon, authenticated;
grant select on table public.contract_file_audit to authenticated;
grant select, insert on table public.contract_file_audit to service_role;

drop policy if exists contract_file_audit_app_read on public.contract_file_audit;
create policy contract_file_audit_app_read
on public.contract_file_audit for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and profile.status = 'active'
      and profile.deleted_at is null
  )
);

alter table public.contracts
  drop constraint if exists contracts_contract_file_mime_type_check,
  drop constraint if exists contracts_contract_file_size_bytes_check;

alter table public.contracts
  add constraint contracts_contract_file_mime_type_check check (
    contract_file_mime_type is null
    or lower(contract_file_mime_type) in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  add constraint contracts_contract_file_size_bytes_check check (
    contract_file_size_bytes is null
    or contract_file_size_bytes between 1 and 26214400
  );

-- PR checklist rows remain an audit record per PR, but a contract-page row can
-- now point at the contract's Supabase Storage object.  The same storage key
-- is intentionally allowed on multiple rows because it is a shared object.
alter table public.purchase_request_attachments
  add column if not exists storage_backend text not null default 'r2',
  add column if not exists source_contract_id bigint references public.contracts(id) on delete restrict;

alter table public.purchase_request_attachments
  alter column upload_ticket_id drop not null,
  alter column mime_type drop not null,
  alter column size_bytes drop not null;

alter table public.purchase_request_attachments
  drop constraint if exists purchase_request_attachments_storage_key_key,
  drop constraint if exists purchase_request_attachments_storage_key_check,
  drop constraint if exists purchase_request_attachments_size_bytes_check,
  drop constraint if exists purchase_request_attachments_deletion_reason_check;

alter table public.purchase_request_attachments
  add constraint purchase_request_attachments_storage_backend_check check (
    (
      storage_backend = 'r2'
      and upload_ticket_id is not null
      and source_contract_id is null
      and storage_key like 'labcbh-stock/pr-checklists/uploads/%'
    )
    or
    (
      storage_backend = 'supabase_storage'
      and upload_ticket_id is null
      and source_contract_id is not null
      and storage_key like 'contracts/%'
      and storage_key not like '%..%'
    )
  ),
  add constraint purchase_request_attachments_storage_key_check check (
    storage_key not like '%..%'
  ),
  add constraint purchase_request_attachments_size_bytes_check check (
    (
      storage_backend = 'r2'
      and mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      and size_bytes between 1 and 20971520
    )
    or
    (
      storage_backend = 'supabase_storage'
      and (mime_type is null or mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'))
      and (size_bytes is null or size_bytes between 1 and 26214400)
    )
  ),
  add constraint purchase_request_attachments_deletion_reason_check check (
    deletion_reason in ('replaced', 'edit_removed', 'received', 'closed_short', 'winner_announced', 'contract_closed')
    or deletion_reason is null
  );

create index if not exists purchase_request_attachments_source_contract_idx
  on public.purchase_request_attachments (source_contract_id, uploaded_at desc)
  where source_contract_id is not null;

-- Keep the old three-argument function name from becoming an accidental path
-- that loses metadata.  All callers now use the explicit six-argument form.
drop function if exists public.set_contract_file(uuid, bigint, text);

create or replace function public.set_contract_file(
  p_actor_id uuid,
  p_contract_id bigint,
  p_file_url text,
  p_file_name text,
  p_file_mime_type text,
  p_file_size_bytes bigint
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated public.contracts%rowtype;
  normalized_url text;
begin
  perform public.assert_contract_editor_actor(p_actor_id);
  normalized_url := nullif(btrim(p_file_url), '');

  select contract.* into updated
  from public.contracts contract
  where contract.id = p_contract_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contract not found';
  end if;

  if updated.status in ('expired', 'cancelled') or coalesce(updated.is_archived, false) then
    raise exception using errcode = '55000', message = 'closed contract cannot change its file';
  end if;

  if normalized_url is null and exists (
    select 1
    from public.purchase_request_attachments attachment
    where attachment.source_contract_id = p_contract_id
      and attachment.object_deleted_at is null
  ) then
    raise exception using errcode = '55000', message = 'contract file is still referenced by purchase requests';
  end if;

  if normalized_url is not null then
    if normalized_url like '%..%' or normalized_url not like 'contracts/' || p_contract_id::text || '/%' then
      raise exception using errcode = '22023', message = 'contract file path is outside the contract namespace';
    end if;
    if nullif(btrim(coalesce(p_file_name, '')), '') is null then
      raise exception using errcode = '22023', message = 'contract file name is required';
    end if;
    if lower(btrim(coalesce(p_file_mime_type, ''))) not in (
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
    ) then
      raise exception using errcode = '22023', message = 'invalid contract file MIME type';
    end if;
    if p_file_size_bytes is null or p_file_size_bytes not between 1 and 26214400 then
      raise exception using errcode = '22023', message = 'contract file size is invalid';
    end if;
  end if;

  update public.contracts
  set
    file_url = normalized_url,
    contract_file_name = case when normalized_url is null then null else btrim(p_file_name) end,
    contract_file_mime_type = case when normalized_url is null then null else lower(btrim(p_file_mime_type)) end,
    contract_file_size_bytes = case when normalized_url is null then null else p_file_size_bytes end
  where id = p_contract_id
  returning * into updated;

  return updated;
end
$function$;

revoke execute on function public.set_contract_file(uuid, bigint, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.set_contract_file(uuid, bigint, text, text, text, bigint) to service_role;

-- Convert a contractFile checklist reference into the ordinary attachmentId
-- shape understood by the existing checklist transaction.  The source row is
-- created in the same transaction, so a failed PR cannot leave an orphan
-- reference.  p_is_update is true for the inner call because the source row
-- already exists by the time the shared validator sees it.
create or replace function public.apply_purchase_request_checklist_with_contract_file(
  p_pr_id uuid,
  p_actor_id uuid,
  p_upload_session_id uuid,
  p_attachments jsonb,
  p_committees jsonb,
  p_is_update boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_request public.purchase_requests%rowtype;
  contract_row public.contracts%rowtype;
  payload jsonb;
  transformed_attachments jsonb;
  contract_id bigint;
  contract_file_count integer := 0;
  source_attachment_id uuid;
  created_source boolean := false;
begin
  if p_attachments is not null and jsonb_typeof(p_attachments) = 'array' then
    select count(*) into contract_file_count
    from jsonb_array_elements(p_attachments) entry
    where entry ? 'contractFile';
  end if;

  if contract_file_count = 0 then
    perform public.apply_purchase_request_checklist(
      p_pr_id, p_actor_id, p_upload_session_id, p_attachments, p_committees, p_is_update
    );
    return;
  end if;

  if contract_file_count <> 1 then
    raise exception using errcode = '23514', message = 'contract purchase requires exactly one shared contract file';
  end if;

  select request.* into target_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'purchase request not found';
  end if;
  if target_request.purchase_method <> 'contract' then
    raise exception using errcode = '23514', message = 'shared contract file is only valid for contract purchases';
  end if;

  select entry into payload
  from jsonb_array_elements(p_attachments) entry
  where entry ? 'contractFile'
  limit 1;
  if coalesce(payload ->> 'contractFile', '') <> 'true'
     or payload ->> 'kind' <> 'contract_page'
     or coalesce(payload ->> 'slot', '') <> '1' then
    raise exception using errcode = '22023', message = 'invalid shared contract file reference';
  end if;

  begin
    contract_id := nullif(target_request.method_details ->> 'contractId', '')::bigint;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid contract id for shared contract file';
  end;
  if contract_id is null then
    raise exception using errcode = '23503', message = 'contract for shared contract file is missing';
  end if;

  select contract.* into contract_row
  from public.contracts contract
  where contract.id = contract_id
    and not coalesce(contract.is_archived, false)
    and contract.status = 'active'
    and contract.file_url is not null
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'contract has no active shared file';
  end if;
  if contract_row.file_url like '%..%'
     or contract_row.file_url not like 'contracts/' || contract_id::text || '/%' then
    raise exception using errcode = '22023', message = 'shared contract file path is invalid';
  end if;

  select attachment.id into source_attachment_id
  from public.purchase_request_attachments attachment
  where attachment.purchase_request_id = p_pr_id
    and attachment.attachment_kind = 'contract_page'
    and attachment.slot = 1
    and attachment.deleted_at is null
    and attachment.storage_backend = 'supabase_storage'
    and attachment.source_contract_id = contract_id
    and attachment.storage_key = contract_row.file_url
  order by attachment.uploaded_at desc
  limit 1;

  if source_attachment_id is null then
    with removed as (
      update public.purchase_request_attachments attachment
      set deleted_at = now(),
          deleted_by = p_actor_id,
          deletion_reason = 'replaced'
      where attachment.purchase_request_id = p_pr_id
        and attachment.attachment_kind = 'contract_page'
        and attachment.slot = 1
        and attachment.deleted_at is null
      returning attachment.id
    )
    insert into public.purchase_request_checklist_events (
      purchase_request_id, attachment_id, event_type, detail, actor_id
    )
    select p_pr_id, removed.id, 'attachment_removed', jsonb_build_object('reason', 'replaced'), p_actor_id
    from removed;

    insert into public.purchase_request_attachments (
      purchase_request_id, upload_ticket_id, attachment_kind, slot, storage_key,
      file_name, mime_type, size_bytes, uploaded_by, storage_backend, source_contract_id
    ) values (
      p_pr_id,
      null,
      'contract_page',
      1,
      contract_row.file_url,
      coalesce(nullif(btrim(contract_row.contract_file_name), ''), regexp_replace(contract_row.file_url, '^.*/', '')),
      contract_row.contract_file_mime_type,
      contract_row.contract_file_size_bytes,
      p_actor_id,
      'supabase_storage',
      contract_id
    )
    returning id into source_attachment_id;
    created_source := true;
  end if;

  select coalesce(jsonb_agg(
    case
      when entry ? 'contractFile' then jsonb_build_object(
        'kind', 'contract_page',
        'slot', 1,
        'attachmentId', source_attachment_id::text
      )
      else entry
    end
  ), '[]'::jsonb)
  into transformed_attachments
  from jsonb_array_elements(p_attachments) entry;

  perform public.apply_purchase_request_checklist(
    p_pr_id,
    p_actor_id,
    p_upload_session_id,
    transformed_attachments,
    p_committees,
    true
  );

  if created_source then
    insert into public.purchase_request_checklist_events (
      purchase_request_id, contract_id, attachment_id, event_type, detail, actor_id
    ) values (
      p_pr_id,
      contract_id,
      source_attachment_id,
      'contract_file_reused',
      jsonb_build_object('storageKey', contract_row.file_url),
      p_actor_id
    );
  end if;
end
$function$;

create or replace function public.create_purchase_request_with_checklist(
  p_actor_id uuid,
  p_request jsonb,
  p_items jsonb,
  p_upload_session_id uuid,
  p_attachments jsonb,
  p_committees jsonb
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_request public.purchase_requests%rowtype;
begin
  if p_upload_session_id is null then
    raise exception using errcode = '22004', message = 'upload session is required';
  end if;

  select request.* into created_request
  from public.purchase_requests request
  where request.checklist_upload_session_id = p_upload_session_id
    and request.requester_id = p_actor_id;
  if found then return created_request; end if;

  created_request := public.create_purchase_request(p_actor_id, p_request, p_items);
  update public.purchase_requests
  set checklist_upload_session_id = p_upload_session_id
  where id = created_request.id;

  perform public.apply_purchase_request_checklist_with_contract_file(
    created_request.id, p_actor_id, p_upload_session_id,
    p_attachments, p_committees, false
  );
  select request.* into created_request from public.purchase_requests request where request.id = created_request.id;
  return created_request;
end
$function$;

create or replace function public.update_purchase_request_with_checklist(
  p_pr_id uuid,
  p_actor_id uuid,
  p_request jsonb,
  p_items jsonb,
  p_upload_session_id uuid,
  p_attachments jsonb,
  p_committees jsonb
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_request public.purchase_requests%rowtype;
begin
  updated_request := public.update_purchase_request(p_pr_id, p_actor_id, p_request, p_items);
  perform public.apply_purchase_request_checklist_with_contract_file(
    p_pr_id, p_actor_id, p_upload_session_id,
    p_attachments, p_committees, true
  );
  select request.* into updated_request from public.purchase_requests request where request.id = p_pr_id;
  return updated_request;
end
$function$;

-- The application clears the DB pointer first and then removes every object
-- belonging to this contract.  This RPC makes all PR references unavailable
-- even if Storage is temporarily unavailable; the caller queues a retry for
-- any physical deletion that fails.
create or replace function public.finalize_contract_file_hard_delete(
  p_contract_id bigint,
  p_actor_id uuid,
  p_file_paths jsonb
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_contract public.contracts%rowtype;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  select contract.* into current_contract
  from public.contracts contract
  where contract.id = p_contract_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contract not found';
  end if;
  if coalesce(current_contract.status, '') not in ('expired', 'cancelled')
     and not coalesce(current_contract.is_archived, false) then
    raise exception using errcode = '55000', message = 'contract is not closed';
  end if;

  if p_file_paths is not null and jsonb_typeof(p_file_paths) <> 'array' then
    raise exception using errcode = '22023', message = 'contract file paths must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(p_file_paths, '[]'::jsonb)) path
    where path.value like '%..%'
       or path.value not like 'contracts/' || p_contract_id::text || '/%'
       or path.value like 'contracts/' || p_contract_id::text || '/%/%'
  ) then
    raise exception using errcode = '22023', message = 'contract file path is outside the contract namespace';
  end if;

  -- Include the current pointer, every PR reference, and the folder paths
  -- supplied by the application. The last group covers files detached or
  -- replaced before close, so their deletion is audited as well.
  with candidates(file_url, file_name, mime_type, size_bytes, priority) as (
    select current_contract.file_url,
           current_contract.contract_file_name,
           current_contract.contract_file_mime_type,
           current_contract.contract_file_size_bytes,
           1
    where current_contract.file_url is not null
    union all
    select attachment.storage_key,
           attachment.file_name,
           attachment.mime_type,
           attachment.size_bytes,
           2
    from public.purchase_request_attachments attachment
    where attachment.source_contract_id = p_contract_id
      and attachment.storage_backend = 'supabase_storage'
    union all
    select path.value, null, null, null, 3
    from jsonb_array_elements_text(coalesce(p_file_paths, '[]'::jsonb)) path
  ), deduplicated as (
    select distinct on (file_url) file_url, file_name, mime_type, size_bytes
    from candidates
    where file_url is not null
    order by file_url, priority
  )
  insert into public.contract_file_audit (
    contract_id, action, file_url, file_name, mime_type, size_bytes, actor_id
  )
  select p_contract_id,
         'deleted',
         deduplicated.file_url,
         coalesce(deduplicated.file_name, regexp_replace(deduplicated.file_url, '^.*/', '')),
         deduplicated.mime_type,
         deduplicated.size_bytes,
         p_actor_id
  from deduplicated
  where not exists (
    select 1
    from public.contract_file_audit existing_audit
    where existing_audit.contract_id = p_contract_id
      and existing_audit.action = 'deleted'
      and existing_audit.file_url = deduplicated.file_url
  );

  if current_contract.file_url is not null then
    insert into public.purchase_request_checklist_events (
      contract_id, event_type, detail, actor_id
    ) values (
      p_contract_id,
      'contract_file_deleted',
      jsonb_build_object(
        'storageKey', current_contract.file_url,
        'fileName', current_contract.contract_file_name,
        'reason', 'contract_closed'
      ),
      p_actor_id
    );
  end if;

  with deleted as (
    update public.purchase_request_attachments attachment
    set deleted_at = coalesce(attachment.deleted_at, now()),
        deleted_by = coalesce(attachment.deleted_by, p_actor_id),
        deletion_reason = coalesce(attachment.deletion_reason, 'contract_closed'),
        object_deleted_at = coalesce(attachment.object_deleted_at, now())
    where attachment.source_contract_id = p_contract_id
      and attachment.object_deleted_at is null
    returning attachment.id, attachment.purchase_request_id
  )
  insert into public.purchase_request_checklist_events (
    purchase_request_id, contract_id, attachment_id, event_type, detail, actor_id
  )
  select deleted.purchase_request_id, p_contract_id, deleted.id,
         'contract_file_reference_deleted', jsonb_build_object('reason', 'contract_closed'), p_actor_id
  from deleted;

  update public.contracts
  set file_url = null,
      contract_file_name = null,
      contract_file_mime_type = null,
      contract_file_size_bytes = null
  where id = p_contract_id
  returning * into current_contract;

  return current_contract;
end
$function$;

revoke execute on function public.apply_purchase_request_checklist_with_contract_file(uuid, uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.create_purchase_request_with_checklist(uuid, jsonb, jsonb, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.update_purchase_request_with_checklist(uuid, uuid, jsonb, jsonb, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.finalize_contract_file_hard_delete(bigint, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.apply_purchase_request_checklist_with_contract_file(uuid, uuid, uuid, jsonb, jsonb, boolean) to service_role;
grant execute on function public.create_purchase_request_with_checklist(uuid, jsonb, jsonb, uuid, jsonb, jsonb) to service_role;
grant execute on function public.update_purchase_request_with_checklist(uuid, uuid, jsonb, jsonb, uuid, jsonb, jsonb) to service_role;
grant execute on function public.finalize_contract_file_hard_delete(bigint, uuid, jsonb) to service_role;

commit;
