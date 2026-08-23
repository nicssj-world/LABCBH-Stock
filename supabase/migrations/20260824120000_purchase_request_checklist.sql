-- Mandatory PR supporting-document checklist, committee rosters, and an
-- auditable R2 object lifecycle. Existing PRs deliberately keep a NULL policy
-- version and remain exempt from the new submission gate.
begin;

alter table public.purchase_requests
  add column if not exists checklist_policy_version integer,
  add column if not exists checklist_completed_at timestamptz,
  add column if not exists checklist_upload_session_id uuid;

create unique index if not exists purchase_requests_checklist_upload_session_key
  on public.purchase_requests (checklist_upload_session_id)
  where checklist_upload_session_id is not null;

create table public.purchase_request_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  upload_session_id uuid not null,
  attachment_kind text not null check (attachment_kind in ('tor', 'quotation', 'plan_page', 'contract_page')),
  slot smallint not null check (slot between 1 and 3),
  storage_key text not null unique,
  file_name text not null check (nullif(btrim(file_name), '') is not null),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  cancelled_at timestamptz,
  purchase_request_id uuid references public.purchase_requests(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (attachment_kind <> 'tor' or mime_type = 'application/pdf'),
  check (
    storage_key like 'labcbh-stock/pr-checklists/uploads/%'
    and storage_key not like '%..%'
  )
);

create unique index purchase_request_upload_tickets_open_slot_key
  on public.purchase_request_upload_tickets (actor_id, upload_session_id, attachment_kind, slot)
  where claimed_at is null and cancelled_at is null;
create index purchase_request_upload_tickets_expiry_idx
  on public.purchase_request_upload_tickets (expires_at)
  where claimed_at is null;

create table public.purchase_request_attachments (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  upload_ticket_id uuid not null unique references public.purchase_request_upload_tickets(id) on delete restrict,
  attachment_kind text not null check (attachment_kind in ('tor', 'quotation', 'plan_page', 'contract_page')),
  slot smallint not null check (slot between 1 and 3),
  storage_key text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete restrict,
  deletion_reason text check (deletion_reason in ('replaced', 'edit_removed', 'received', 'closed_short', 'winner_announced')),
  object_deleted_at timestamptz,
  check (attachment_kind <> 'tor' or mime_type = 'application/pdf'),
  check (
    storage_key like 'labcbh-stock/pr-checklists/uploads/%'
    and storage_key not like '%..%'
  )
);

create unique index purchase_request_attachments_active_slot_key
  on public.purchase_request_attachments (purchase_request_id, attachment_kind, slot)
  where deleted_at is null;
create index purchase_request_attachments_cleanup_idx
  on public.purchase_request_attachments (purchase_request_id, object_deleted_at)
  where object_deleted_at is null;

create table public.purchase_request_committees (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  committee_kind text not null check (committee_kind in ('specification', 'result', 'inspection')),
  seat smallint not null check (seat between 1 and 3),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  name_snapshot text not null,
  position_snapshot text,
  source_contract_id bigint references public.contracts(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (purchase_request_id, committee_kind, seat),
  unique (purchase_request_id, committee_kind, profile_id)
);

create index purchase_request_committees_profile_idx
  on public.purchase_request_committees (profile_id);

create table public.contract_committees (
  id uuid primary key default gen_random_uuid(),
  contract_id bigint not null references public.contracts(id) on delete restrict,
  committee_kind text not null check (committee_kind in ('specification', 'result', 'inspection')),
  seat smallint not null check (seat between 1 and 3),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  name_snapshot text not null,
  position_snapshot text,
  source_purchase_request_id uuid references public.purchase_requests(id) on delete restrict,
  configured_by uuid references public.profiles(id) on delete restrict,
  configured_at timestamptz not null default now(),
  unique (contract_id, committee_kind, seat),
  unique (contract_id, committee_kind, profile_id)
);

create index contract_committees_profile_idx on public.contract_committees (profile_id);

create table public.purchase_request_checklist_events (
  id bigint generated always as identity primary key,
  purchase_request_id uuid references public.purchase_requests(id) on delete restrict,
  contract_id bigint references public.contracts(id) on delete restrict,
  attachment_id uuid references public.purchase_request_attachments(id) on delete restrict,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (purchase_request_id is not null or contract_id is not null)
);

create index purchase_request_checklist_events_pr_idx
  on public.purchase_request_checklist_events (purchase_request_id, created_at desc);
create index purchase_request_checklist_events_contract_idx
  on public.purchase_request_checklist_events (contract_id, created_at desc);

alter table public.purchase_request_upload_tickets enable row level security;
alter table public.purchase_request_attachments enable row level security;
alter table public.purchase_request_committees enable row level security;
alter table public.contract_committees enable row level security;
alter table public.purchase_request_checklist_events enable row level security;

revoke all on table public.purchase_request_upload_tickets from anon, authenticated;
revoke all on table public.purchase_request_attachments from anon, authenticated;
revoke all on table public.purchase_request_committees from anon, authenticated;
revoke all on table public.contract_committees from anon, authenticated;
revoke all on table public.purchase_request_checklist_events from anon, authenticated;

create or replace function public.assert_purchase_request_upload_actor(p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_id
      and profile.status = 'active'
      and profile.deleted_at is null
      and (
        profile.ephis_id = '9495'
        or profile.role = 'Manager'
        or exists (
          select 1
          from public.lab_stock_memberships membership
          where membership.profile_id = profile.id
            and membership.active
            and membership.role in ('admin', 'head', 'stock_officer')
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'actor is not allowed to upload purchase request checklist files';
  end if;
end
$function$;

create or replace function public.register_purchase_request_checklist_upload(
  p_actor_id uuid,
  p_upload_session_id uuid,
  p_attachment_kind text,
  p_slot integer,
  p_storage_key text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_expires_at timestamptz
)
returns public.purchase_request_upload_tickets
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_ticket public.purchase_request_upload_tickets%rowtype;
begin
  perform public.assert_purchase_request_upload_actor(p_actor_id);

  if p_upload_session_id is null then
    raise exception using errcode = '22004', message = 'upload session is required';
  end if;
  if p_attachment_kind not in ('tor', 'quotation', 'plan_page', 'contract_page') then
    raise exception using errcode = '22023', message = 'invalid attachment kind';
  end if;
  if p_slot is null or p_slot < 1 or p_slot > 3 then
    raise exception using errcode = '22023', message = 'invalid attachment slot';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 20971520 then
    raise exception using errcode = '22023', message = 'attachment must not exceed 20 MB';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     or (p_attachment_kind = 'tor' and p_mime_type <> 'application/pdf') then
    raise exception using errcode = '22023', message = 'invalid attachment MIME type';
  end if;
  if nullif(btrim(coalesce(p_file_name, '')), '') is null then
    raise exception using errcode = '22023', message = 'attachment filename is required';
  end if;
  if p_storage_key not like 'labcbh-stock/pr-checklists/uploads/' || p_actor_id::text || '/' || p_upload_session_id::text || '/%'
     or p_storage_key like '%..%' then
    raise exception using errcode = '22023', message = 'attachment storage key is outside the PR namespace';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '2 hours' then
    raise exception using errcode = '22023', message = 'invalid upload ticket expiry';
  end if;

  update public.purchase_request_upload_tickets ticket
  set cancelled_at = now()
  where ticket.actor_id = p_actor_id
    and ticket.upload_session_id = p_upload_session_id
    and ticket.attachment_kind = p_attachment_kind
    and ticket.slot = p_slot
    and ticket.claimed_at is null
    and ticket.cancelled_at is null;

  insert into public.purchase_request_upload_tickets (
    actor_id, upload_session_id, attachment_kind, slot, storage_key,
    file_name, mime_type, size_bytes, expires_at
  ) values (
    p_actor_id, p_upload_session_id, p_attachment_kind, p_slot, p_storage_key,
    btrim(p_file_name), p_mime_type, p_size_bytes, p_expires_at
  )
  returning * into created_ticket;

  return created_ticket;
end
$function$;

create or replace function public.apply_purchase_request_checklist(
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
  total_amount numeric := 0;
  expected_quotes integer := 0;
  expected_seats integer := 0;
  expected_attachment_count integer := 0;
  expected_committee_count integer := 0;
  submitted_count integer := 0;
  submitted_distinct_count integer := 0;
  payload jsonb;
  payload_kind text;
  payload_slot integer;
  payload_attachment_id uuid;
  payload_upload_id uuid;
  ticket public.purchase_request_upload_tickets%rowtype;
  profile_row public.profiles%rowtype;
  contract_id bigint;
  committee_kind text;
  committee_seat integer;
  committee_profile_id uuid;
begin
  select request.* into target_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'purchase request not found';
  end if;

  perform public.assert_purchase_request_manager(p_actor_id, target_request.requester_id);
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception using errcode = '22023', message = 'checklist attachments must be an array';
  end if;
  if p_committees is null or jsonb_typeof(p_committees) <> 'array' then
    raise exception using errcode = '22023', message = 'committee assignments must be an array';
  end if;

  select coalesce(sum(item.line_total), 0) into total_amount
  from public.purchase_request_items item
  where item.purchase_request_id = p_pr_id;

  if target_request.purchase_method = 'contract' then
    expected_attachment_count := 1;
    expected_committee_count := 0;
  elsif target_request.purchase_method in ('specific_contract', 'e_bidding', 'equipment_lease') then
    expected_quotes := 3;
    expected_seats := 3;
    expected_attachment_count := 5;
    expected_committee_count := case when target_request.purchase_method in ('e_bidding', 'equipment_lease') then 9 else 6 end;
  else
    expected_quotes := case when total_amount >= 50000 then 3 else 1 end;
    expected_seats := case when total_amount >= 100000 then 3 else 1 end;
    expected_attachment_count := 1 + expected_quotes + case when target_request.purchase_method = 'annual_plan' then 1 else 0 end;
    expected_committee_count := expected_seats * 2;
  end if;

  select count(*), count(distinct (entry ->> 'kind') || ':' || (entry ->> 'slot'))
  into submitted_count, submitted_distinct_count
  from jsonb_array_elements(p_attachments) entry;
  if submitted_count <> expected_attachment_count or submitted_distinct_count <> submitted_count then
    raise exception using errcode = '23514', message = 'purchase request checklist attachments are incomplete or duplicated';
  end if;

  for payload in select * from jsonb_array_elements(p_attachments)
  loop
    if jsonb_typeof(payload) <> 'object'
       or coalesce(payload ->> 'slot', '') !~ '^[1-3]$' then
      raise exception using errcode = '22023', message = 'invalid checklist attachment entry';
    end if;
    payload_kind := payload ->> 'kind';
    payload_slot := (payload ->> 'slot')::integer;

    if target_request.purchase_method = 'contract' then
      if payload_kind <> 'contract_page' or payload_slot <> 1 then
        raise exception using errcode = '23514', message = 'contract purchase requires exactly one contract page';
      end if;
    else
      if payload_kind = 'tor' and payload_slot <> 1 then
        raise exception using errcode = '23514', message = 'TOR slot is invalid';
      elsif payload_kind = 'quotation' and payload_slot > expected_quotes then
        raise exception using errcode = '23514', message = 'quotation slot exceeds the purchase threshold';
      elsif payload_kind = 'plan_page' and (target_request.purchase_method not in ('annual_plan', 'specific_contract', 'e_bidding', 'equipment_lease') or payload_slot <> 1) then
        raise exception using errcode = '23514', message = 'plan page is not required for this purchase method';
      elsif payload_kind not in ('tor', 'quotation', 'plan_page') then
        raise exception using errcode = '23514', message = 'unexpected checklist attachment kind';
      end if;
    end if;

    if (payload ? 'attachmentId') = (payload ? 'uploadId') then
      raise exception using errcode = '22023', message = 'attachment entry must reference exactly one existing attachment or upload ticket';
    end if;

    if payload ? 'attachmentId' then
      begin
        payload_attachment_id := (payload ->> 'attachmentId')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'invalid existing attachment id';
      end;
      if not p_is_update or not exists (
        select 1 from public.purchase_request_attachments attachment
        where attachment.id = payload_attachment_id
          and attachment.purchase_request_id = p_pr_id
          and attachment.attachment_kind = payload_kind
          and attachment.slot = payload_slot
          and attachment.deleted_at is null
      ) then
        raise exception using errcode = '23503', message = 'existing checklist attachment is unavailable';
      end if;
    else
      begin
        payload_upload_id := (payload ->> 'uploadId')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'invalid upload ticket id';
      end;
      select upload.* into ticket
      from public.purchase_request_upload_tickets upload
      where upload.id = payload_upload_id
      for update;
      if not found
         or ticket.actor_id <> p_actor_id
         or ticket.upload_session_id <> p_upload_session_id
         or ticket.attachment_kind <> payload_kind
         or ticket.slot <> payload_slot
         or ticket.cancelled_at is not null then
        raise exception using errcode = '23503', message = 'upload ticket does not match the checklist slot';
      end if;
      if ticket.expires_at <= now() and ticket.claimed_at is null then
        raise exception using errcode = '55000', message = 'upload ticket expired';
      end if;
      if ticket.claimed_at is not null and ticket.purchase_request_id is distinct from p_pr_id then
        raise exception using errcode = '55000', message = 'upload ticket already claimed';
      end if;
    end if;
  end loop;

  with removed as (
    update public.purchase_request_attachments attachment
    set deleted_at = now(), deleted_by = p_actor_id,
        deletion_reason = case
          when exists (
            select 1 from jsonb_array_elements(p_attachments) replacement
            where replacement ->> 'kind' = attachment.attachment_kind
              and (replacement ->> 'slot')::integer = attachment.slot
          ) then 'replaced'
          else 'edit_removed'
        end
    where attachment.purchase_request_id = p_pr_id
      and attachment.deleted_at is null
      and not exists (
        select 1 from jsonb_array_elements(p_attachments) retained
        where retained ->> 'attachmentId' = attachment.id::text
      )
    returning attachment.id, attachment.deletion_reason
  )
  insert into public.purchase_request_checklist_events (
    purchase_request_id, attachment_id, event_type, detail, actor_id
  )
  select p_pr_id, removed.id, 'attachment_removed', jsonb_build_object('reason', removed.deletion_reason), p_actor_id
  from removed;

  for payload in select * from jsonb_array_elements(p_attachments)
  loop
    if payload ? 'uploadId' then
      payload_upload_id := (payload ->> 'uploadId')::uuid;
      update public.purchase_request_upload_tickets upload
      set claimed_at = coalesce(upload.claimed_at, now()), purchase_request_id = p_pr_id
      where upload.id = payload_upload_id;

      insert into public.purchase_request_attachments (
        purchase_request_id, upload_ticket_id, attachment_kind, slot, storage_key,
        file_name, mime_type, size_bytes, uploaded_by
      )
      select p_pr_id, upload.id, upload.attachment_kind, upload.slot, upload.storage_key,
             upload.file_name, upload.mime_type, upload.size_bytes, p_actor_id
      from public.purchase_request_upload_tickets upload
      where upload.id = payload_upload_id
      on conflict (upload_ticket_id) do nothing;

      insert into public.purchase_request_checklist_events (
        purchase_request_id, attachment_id, event_type, detail, actor_id
      )
      select p_pr_id, attachment.id, 'attachment_added',
             jsonb_build_object('kind', attachment.attachment_kind, 'slot', attachment.slot), p_actor_id
      from public.purchase_request_attachments attachment
      where attachment.upload_ticket_id = payload_upload_id
        and not exists (
          select 1 from public.purchase_request_checklist_events event
          where event.attachment_id = attachment.id and event.event_type = 'attachment_added'
        );
    end if;
  end loop;

  if (select count(*) from public.purchase_request_attachments attachment where attachment.purchase_request_id = p_pr_id and attachment.deleted_at is null) <> expected_attachment_count then
    raise exception using errcode = '23514', message = 'purchase request checklist attachment count is invalid';
  end if;

  delete from public.purchase_request_committees committee where committee.purchase_request_id = p_pr_id;

  if target_request.purchase_method = 'contract' then
    contract_id := nullif(target_request.method_details ->> 'contractId', '')::bigint;
    if (select count(*) from public.contract_committees committee where committee.contract_id = contract_id and committee.committee_kind = 'specification') <> 3
       or (select count(*) from public.contract_committees committee where committee.contract_id = contract_id and committee.committee_kind = 'inspection') <> 3
       or (select count(*) from public.contract_committees committee where committee.contract_id = contract_id and committee.committee_kind = 'result') not in (0, 3) then
      raise exception using errcode = '23514', message = 'contract committee roster is incomplete';
    end if;
    if jsonb_array_length(p_committees) <> 0 then
      raise exception using errcode = '23514', message = 'contract purchase committees must be inherited';
    end if;

    insert into public.purchase_request_committees (
      purchase_request_id, committee_kind, seat, profile_id,
      name_snapshot, position_snapshot, source_contract_id
    )
    select p_pr_id, committee.committee_kind, committee.seat, committee.profile_id,
           committee.name_snapshot, committee.position_snapshot, contract_id
    from public.contract_committees committee
    where committee.contract_id = contract_id;
  else
    if jsonb_array_length(p_committees) <> expected_committee_count then
      raise exception using errcode = '23514', message = 'purchase request committee assignments are incomplete';
    end if;
    if (select count(distinct (entry ->> 'kind') || ':' || (entry ->> 'seat')) from jsonb_array_elements(p_committees) entry) <> expected_committee_count then
      raise exception using errcode = '23514', message = 'purchase request committee seats are duplicated';
    end if;

    for payload in select * from jsonb_array_elements(p_committees)
    loop
      committee_kind := payload ->> 'kind';
      if coalesce(payload ->> 'seat', '') !~ '^[1-3]$' then
        raise exception using errcode = '22023', message = 'invalid committee seat';
      end if;
      committee_seat := (payload ->> 'seat')::integer;
      begin
        committee_profile_id := (payload ->> 'profileId')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'invalid committee profile';
      end;

      if committee_kind not in ('specification', 'result', 'inspection')
         or committee_seat > expected_seats
         or (committee_kind = 'result' and target_request.purchase_method not in ('e_bidding', 'equipment_lease')) then
        raise exception using errcode = '23514', message = 'committee assignment does not match the purchase method';
      end if;

      select profile.* into profile_row
      from public.profiles profile
      where profile.id = committee_profile_id
        and profile.status = 'active'
        and profile.deleted_at is null;
      if not found or nullif(btrim(coalesce(profile_row.name, '')), '') is null then
        raise exception using errcode = '23503', message = 'committee profile is not active';
      end if;

      insert into public.purchase_request_committees (
        purchase_request_id, committee_kind, seat, profile_id,
        name_snapshot, position_snapshot
      ) values (
        p_pr_id, committee_kind, committee_seat, committee_profile_id,
        btrim(profile_row.name), nullif(btrim(coalesce(profile_row.position_title, '')), '')
      );
    end loop;

    if exists (
      select 1
      from public.purchase_request_committees inspection
      join public.purchase_request_committees other
        on other.purchase_request_id = inspection.purchase_request_id
       and other.profile_id = inspection.profile_id
       and other.committee_kind in ('specification', 'result')
      where inspection.purchase_request_id = p_pr_id
        and inspection.committee_kind = 'inspection'
    ) then
      raise exception using errcode = '23514', message = 'inspection committee cannot overlap specification or result committees';
    end if;
  end if;

  update public.purchase_requests
  set checklist_policy_version = 1,
      checklist_completed_at = now(),
      updated_by = p_actor_id
  where id = p_pr_id;

  insert into public.purchase_request_checklist_events (
    purchase_request_id, event_type, detail, actor_id
  ) values (
    p_pr_id,
    case when p_is_update then 'checklist_updated' else 'checklist_completed' end,
    jsonb_build_object(
      'policyVersion', 1,
      'attachmentCount', expected_attachment_count,
      'committeeCount', (select count(*) from public.purchase_request_committees where purchase_request_id = p_pr_id)
    ),
    p_actor_id
  );
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

  perform public.apply_purchase_request_checklist(
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
  perform public.apply_purchase_request_checklist(
    p_pr_id, p_actor_id, p_upload_session_id,
    p_attachments, p_committees, true
  );
  select request.* into updated_request from public.purchase_requests request where request.id = p_pr_id;
  return updated_request;
end
$function$;

create or replace function public.confirm_purchase_request_with_committees(
  p_pr_id uuid,
  p_actor_id uuid,
  p_sent_to_procurement_date date default null
)
returns public.purchase_requests
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_request public.purchase_requests%rowtype;
  confirmed_request public.purchase_requests%rowtype;
begin
  select request.* into target_request
  from public.purchase_requests request
  where request.id = p_pr_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'purchase request not found';
  end if;

  if target_request.checklist_policy_version is not null then
    if target_request.checklist_policy_version <> 1 or target_request.checklist_completed_at is null then
      raise exception using errcode = '23514', message = 'purchase request checklist is incomplete';
    end if;
    if not exists (select 1 from public.purchase_request_attachments attachment where attachment.purchase_request_id = p_pr_id and attachment.deleted_at is null) then
      raise exception using errcode = '23514', message = 'purchase request checklist has no active attachments';
    end if;
    if exists (
      select 1
      from public.purchase_request_committees committee
      left join public.profiles profile on profile.id = committee.profile_id
      where committee.purchase_request_id = p_pr_id
        and (
          profile.id is null or profile.status <> 'active' or profile.deleted_at is not null
          or nullif(btrim(coalesce(profile.position_title, '')), '') is null
        )
    ) then
      raise exception using errcode = '23514', message = 'committee position_title is incomplete';
    end if;
  end if;

  confirmed_request := public.confirm_purchase_request(p_pr_id, p_actor_id, p_sent_to_procurement_date);

  if target_request.checklist_policy_version is not null and confirmed_request.created_contract_id is not null then
    delete from public.contract_committees committee where committee.contract_id = confirmed_request.created_contract_id;
    insert into public.contract_committees (
      contract_id, committee_kind, seat, profile_id, name_snapshot,
      position_snapshot, source_purchase_request_id, configured_by
    )
    select confirmed_request.created_contract_id, committee.committee_kind, committee.seat,
           committee.profile_id, committee.name_snapshot, committee.position_snapshot,
           p_pr_id, p_actor_id
    from public.purchase_request_committees committee
    where committee.purchase_request_id = p_pr_id;

    insert into public.purchase_request_checklist_events (
      purchase_request_id, contract_id, event_type, detail, actor_id
    ) values (
      p_pr_id, confirmed_request.created_contract_id, 'contract_committee_roster_created',
      jsonb_build_object('sourcePurchaseRequestId', p_pr_id), p_actor_id
    );
  end if;

  return confirmed_request;
end
$function$;

create or replace function public.set_contract_committees(
  p_contract_id bigint,
  p_actor_id uuid,
  p_committees jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract public.contracts%rowtype;
  expected_result_count integer;
  payload jsonb;
  kind text;
  seat_number integer;
  profile_id_value uuid;
  profile_row public.profiles%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);
  select contract.* into target_contract from public.contracts contract where contract.id = p_contract_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'contract not found'; end if;
  if p_committees is null or jsonb_typeof(p_committees) <> 'array' then
    raise exception using errcode = '22023', message = 'contract committees must be an array';
  end if;

  expected_result_count := case when target_contract.contract_type in ('e_bidding', 'equipment_lease') then 3 else 0 end;
  if jsonb_array_length(p_committees) <> 6 + expected_result_count
     or (select count(distinct (entry ->> 'kind') || ':' || (entry ->> 'seat')) from jsonb_array_elements(p_committees) entry) <> 6 + expected_result_count then
    raise exception using errcode = '23514', message = 'contract committee roster is incomplete';
  end if;

  delete from public.contract_committees committee where committee.contract_id = p_contract_id;
  for payload in select * from jsonb_array_elements(p_committees)
  loop
    kind := payload ->> 'kind';
    if coalesce(payload ->> 'seat', '') !~ '^[1-3]$'
       or kind not in ('specification', 'result', 'inspection')
       or (kind = 'result' and expected_result_count = 0) then
      raise exception using errcode = '22023', message = 'invalid contract committee seat';
    end if;
    seat_number := (payload ->> 'seat')::integer;
    begin
      profile_id_value := (payload ->> 'profileId')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid committee profile';
    end;
    select profile.* into profile_row from public.profiles profile
    where profile.id = profile_id_value and profile.status = 'active' and profile.deleted_at is null;
    if not found or nullif(btrim(coalesce(profile_row.name, '')), '') is null then
      raise exception using errcode = '23503', message = 'committee profile is not active';
    end if;
    insert into public.contract_committees (
      contract_id, committee_kind, seat, profile_id, name_snapshot,
      position_snapshot, configured_by
    ) values (
      p_contract_id, kind, seat_number, profile_id_value, btrim(profile_row.name),
      nullif(btrim(coalesce(profile_row.position_title, '')), ''), p_actor_id
    );
  end loop;

  if exists (
    select 1 from public.contract_committees inspection
    join public.contract_committees other
      on other.contract_id = inspection.contract_id
     and other.profile_id = inspection.profile_id
     and other.committee_kind in ('specification', 'result')
    where inspection.contract_id = p_contract_id and inspection.committee_kind = 'inspection'
  ) then
    raise exception using errcode = '23514', message = 'inspection committee cannot overlap specification or result committees';
  end if;

  insert into public.purchase_request_checklist_events (contract_id, event_type, detail, actor_id)
  values (p_contract_id, 'contract_committee_roster_configured', jsonb_build_object('committeeCount', jsonb_array_length(p_committees)), p_actor_id);
  return jsonb_build_object('id', p_contract_id);
end
$function$;

create or replace function public.mark_purchase_request_checklist_objects_deleted(
  p_pr_id uuid,
  p_actor_id uuid,
  p_attachment_ids jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  requester_id_value uuid;
  attachment_id_value uuid;
  deleted_count integer := 0;
begin
  select request.requester_id into requester_id_value from public.purchase_requests request where request.id = p_pr_id;
  if not found then raise exception using errcode = 'P0002', message = 'purchase request not found'; end if;
  if p_reason not in ('replaced', 'edit_removed', 'received', 'closed_short', 'winner_announced') then
    raise exception using errcode = '22023', message = 'invalid checklist deletion reason';
  end if;
  if p_reason = 'winner_announced' then
    perform public.assert_contract_editor_actor(p_actor_id);
  else
    perform public.assert_purchase_request_manager(p_actor_id, requester_id_value);
  end if;
  if p_attachment_ids is null or jsonb_typeof(p_attachment_ids) <> 'array' then
    raise exception using errcode = '22023', message = 'attachment ids must be an array';
  end if;

  for attachment_id_value in select value::text::uuid from jsonb_array_elements_text(p_attachment_ids)
  loop
    update public.purchase_request_attachments attachment
    set deleted_at = coalesce(attachment.deleted_at, now()),
        deleted_by = coalesce(attachment.deleted_by, p_actor_id),
        deletion_reason = coalesce(attachment.deletion_reason, p_reason),
        object_deleted_at = coalesce(attachment.object_deleted_at, now())
    where attachment.id = attachment_id_value
      and attachment.purchase_request_id = p_pr_id
      and attachment.object_deleted_at is null;
    if found then
      deleted_count := deleted_count + 1;
      insert into public.purchase_request_checklist_events (
        purchase_request_id, attachment_id, event_type, detail, actor_id
      ) values (
        p_pr_id, attachment_id_value, 'attachment_object_deleted', jsonb_build_object('reason', p_reason), p_actor_id
      );
    end if;
  end loop;
  return jsonb_build_object('id', p_pr_id, 'deletedCount', deleted_count);
end
$function$;

revoke execute on function public.assert_purchase_request_upload_actor(uuid) from public, anon, authenticated;
revoke execute on function public.register_purchase_request_checklist_upload(uuid, uuid, text, integer, text, text, text, bigint, timestamptz) from public, anon, authenticated;
revoke execute on function public.apply_purchase_request_checklist(uuid, uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.create_purchase_request_with_checklist(uuid, jsonb, jsonb, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.update_purchase_request_with_checklist(uuid, uuid, jsonb, jsonb, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.confirm_purchase_request_with_committees(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.set_contract_committees(bigint, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_purchase_request_checklist_objects_deleted(uuid, uuid, jsonb, text) from public, anon, authenticated;

grant execute on function public.assert_purchase_request_upload_actor(uuid) to service_role;
grant execute on function public.register_purchase_request_checklist_upload(uuid, uuid, text, integer, text, text, text, bigint, timestamptz) to service_role;
grant execute on function public.apply_purchase_request_checklist(uuid, uuid, uuid, jsonb, jsonb, boolean) to service_role;
grant execute on function public.create_purchase_request_with_checklist(uuid, jsonb, jsonb, uuid, jsonb, jsonb) to service_role;
grant execute on function public.update_purchase_request_with_checklist(uuid, uuid, jsonb, jsonb, uuid, jsonb, jsonb) to service_role;
grant execute on function public.confirm_purchase_request_with_committees(uuid, uuid, date) to service_role;
grant execute on function public.set_contract_committees(bigint, uuid, jsonb) to service_role;
grant execute on function public.mark_purchase_request_checklist_objects_deleted(uuid, uuid, jsonb, text) to service_role;

commit;
