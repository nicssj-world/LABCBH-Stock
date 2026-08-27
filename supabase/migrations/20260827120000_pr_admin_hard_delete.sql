-- Irreversible PR deletion is an explicit administrator operation. The
-- database owns the authorization, status guard, relationship checks, and
-- metadata transaction; the server action removes the returned storage keys.
begin;

create or replace function public.hard_delete_purchase_request(
  p_pr_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_request public.purchase_requests%rowtype;
  r2_paths jsonb;
  supabase_storage_paths jsonb;
begin
  perform public.assert_lab_stock_admin_actor(p_actor_id);

  select request.*
  into locked_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'purchase request not found';
  end if;

  if locked_request.status <> 'pending' then
    raise exception using
      errcode = '55000',
      message = 'only a pending purchase request can be hard-deleted';
  end if;

  if locked_request.created_contract_id is not null
     or exists (
       select 1
       from public.contract_committees committee
       where committee.source_purchase_request_id = p_pr_id
     ) then
    raise exception using
      errcode = '55000',
      message = 'purchase request is linked to a contract and cannot be hard-deleted';
  end if;

  if exists (
    select 1
    from public.goods_receipts receipt
    where receipt.purchase_request_id = p_pr_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'purchase request has goods receipt history and cannot be hard-deleted';
  end if;

  if exists (
    select 1
    from public.contract_item_allocations allocation
    join public.purchase_request_items item
      on item.id = allocation.purchase_request_item_id
    where item.purchase_request_id = p_pr_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'purchase request has contract allocation history and cannot be hard-deleted';
  end if;

  if exists (
    select 1
    from public.purchase_request_line_notifications notification
    where notification.purchase_request_id = p_pr_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'purchase request has LINE notification history and cannot be hard-deleted';
  end if;

  if locked_request.po_file_path is not null
     and locked_request.po_file_deleted_at is null
     and (
       locked_request.po_file_path like '%..%'
       or locked_request.po_file_path !~ (
         '^po/' || locked_request.fiscal_year::text || '/' || p_pr_id::text || '/[^/]+$'
       )
     ) then
    raise exception using errcode = '22023', message = 'purchase request PO file path is invalid';
  end if;

  if exists (
    select 1
    from public.purchase_request_attachments attachment
    where attachment.purchase_request_id = p_pr_id
      and attachment.source_contract_id is null
      and attachment.object_deleted_at is null
      and (
        attachment.storage_key like '%..%'
        or attachment.storage_key !~* '^labcbh-stock/pr-checklists/uploads/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]+-[^/]+$'
      )
  ) or exists (
    select 1
    from public.purchase_request_upload_tickets ticket
    where ticket.purchase_request_id = p_pr_id
      and ticket.object_deleted_at is null
      and (
        ticket.storage_key like '%..%'
        or ticket.storage_key !~* '^labcbh-stock/pr-checklists/uploads/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]+-[^/]+$'
      )
  ) then
    raise exception using errcode = '22023', message = 'purchase request checklist file path is invalid';
  end if;

  select coalesce(jsonb_agg(paths.path order by paths.path), '[]'::jsonb)
  into r2_paths
  from (
    select attachment.storage_key as path
    from public.purchase_request_attachments attachment
    where attachment.purchase_request_id = p_pr_id
      and attachment.source_contract_id is null
      and attachment.object_deleted_at is null
    union
    select ticket.storage_key as path
    from public.purchase_request_upload_tickets ticket
    where ticket.purchase_request_id = p_pr_id
      and ticket.object_deleted_at is null
  ) paths;

  supabase_storage_paths := case
    when locked_request.po_file_path is not null
      and locked_request.po_file_deleted_at is null
      then jsonb_build_array(locked_request.po_file_path)
    else '[]'::jsonb
  end;

  -- Do not leave an orphan cleanup job pointing at a ticket that is about to
  -- be removed. The actual object deletion is handled by the server action.
  update public.storage_cleanup_jobs job
  set cancelled_at = coalesce(job.cancelled_at, now()),
      locked_until = null
  where job.job_kind = 'checklist_upload_orphan'
    and job.completed_at is null
    and job.cancelled_at is null
    and job.resource_id in (
      select ticket.id
      from public.purchase_request_upload_tickets ticket
      where ticket.purchase_request_id = p_pr_id
    );

  -- Delete the audit rows and relationship rows that deliberately use ON
  -- DELETE RESTRICT before removing the owned attachment and PR records.
  delete from public.purchase_request_checklist_events event
  where event.purchase_request_id = p_pr_id
     or event.attachment_id in (
       select attachment.id
       from public.purchase_request_attachments attachment
       where attachment.purchase_request_id = p_pr_id
     );

  delete from public.purchase_request_annual_plan_line_references line_reference
  where line_reference.purchase_request_item_id in (
    select item.id
    from public.purchase_request_items item
    where item.purchase_request_id = p_pr_id
  );

  delete from public.purchase_request_annual_plan_references plan_reference
  where plan_reference.purchase_request_id = p_pr_id;

  delete from public.purchase_request_committees committee
  where committee.purchase_request_id = p_pr_id;

  delete from public.purchase_request_attachments attachment
  where attachment.purchase_request_id = p_pr_id;

  delete from public.purchase_request_upload_tickets ticket
  where ticket.purchase_request_id = p_pr_id;

  delete from public.purchase_request_items item
  where item.purchase_request_id = p_pr_id;

  delete from public.purchase_requests request
  where request.id = p_pr_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'purchase request not found';
  end if;

  return jsonb_build_object(
    'id', p_pr_id,
    'deleted', true,
    'fiscalYear', locked_request.fiscal_year,
    'r2Paths', r2_paths,
    'supabaseStoragePaths', supabase_storage_paths
  );
end
$function$;

revoke execute on function public.hard_delete_purchase_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hard_delete_purchase_request(uuid, uuid) to service_role;

commit;
