-- LABCBH Stock — PO evidence, goods receipts, and lot creation.
--
-- Receiving is a draft first and stock second. A draft can be edited and can
-- carry a PO image; posting is the single moment lots appear and positive
-- movements hit the ledger. Posting is idempotent: the Task 5 unique index on
-- (source document, item, lot) turns a retried post into a no-op instead of a
-- duplicate movement, so a double click cannot inflate stock.

begin;

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null check (fiscal_year between 2500 and 3000),
  purchase_request_id uuid references public.purchase_requests(id) on delete restrict,
  po_number text,
  department text not null check (nullif(btrim(department), '') is not null),
  received_date date not null,
  -- Snapshot: the person who physically accepted the delivery, which may not be
  -- the account that keys it in.
  receiver_name text not null check (nullif(btrim(receiver_name), '') is not null),
  received_by uuid references public.profiles(id) on delete restrict,
  po_image_path text,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  note text,
  posted_by uuid references public.profiles(id) on delete restrict,
  posted_at timestamptz,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint goods_receipts_posted_check check (
    (status = 'posted') = (posted_at is not null)
    and (posted_at is null) = (posted_by is null)
  )
);

create table if not exists public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  lot_number text not null check (nullif(btrim(lot_number), '') is not null),
  expiry_date date,
  quantity numeric(15,3) not null check (quantity > 0),
  unit text not null check (nullif(btrim(unit), '') is not null),
  storage_location text,
  -- Filled in by post_goods_receipt once the lot exists.
  inventory_lot_id uuid references public.inventory_lots(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (goods_receipt_id, line_number)
);

-- Task 5 created inventory_lots before this table existed; wire up the real key.
alter table public.inventory_lots
  drop constraint if exists inventory_lots_goods_receipt_item_id_fkey;

alter table public.inventory_lots
  add constraint inventory_lots_goods_receipt_item_id_fkey
  foreign key (goods_receipt_item_id)
  references public.goods_receipt_items(id)
  on delete restrict;

create unique index if not exists goods_receipt_items_lot_key
  on public.goods_receipt_items (goods_receipt_id, inventory_item_id, upper(btrim(lot_number)));
create unique index if not exists goods_receipts_po_number_key
  on public.goods_receipts (lower(btrim(po_number)), received_date)
  where po_number is not null;
create index if not exists goods_receipts_status_idx
  on public.goods_receipts (status, received_date desc);
create index if not exists goods_receipts_purchase_request_idx
  on public.goods_receipts (purchase_request_id) where purchase_request_id is not null;
create index if not exists goods_receipts_received_by_idx
  on public.goods_receipts (received_by) where received_by is not null;
create index if not exists goods_receipts_posted_by_idx
  on public.goods_receipts (posted_by) where posted_by is not null;
create index if not exists goods_receipts_created_by_idx
  on public.goods_receipts (created_by) where created_by is not null;
create index if not exists goods_receipts_updated_by_idx
  on public.goods_receipts (updated_by) where updated_by is not null;
create index if not exists goods_receipt_items_receipt_idx
  on public.goods_receipt_items (goods_receipt_id, line_number);
create index if not exists goods_receipt_items_inventory_item_idx
  on public.goods_receipt_items (inventory_item_id);
create index if not exists goods_receipt_items_lot_idx
  on public.goods_receipt_items (inventory_lot_id) where inventory_lot_id is not null;

drop trigger if exists goods_receipts_set_updated_at on public.goods_receipts;
create trigger goods_receipts_set_updated_at
before update on public.goods_receipts
for each row execute function public.lab_stock_set_updated_at();

create or replace function public.create_goods_receipt(
  p_actor_id uuid,
  p_receipt jsonb,
  p_items jsonb
)
returns public.goods_receipts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  created_receipt public.goods_receipts%rowtype;
  parsed_received_date date;
  line jsonb;
  line_index integer := 0;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object' then
    raise exception using errcode = '22023', message = 'goods receipt payload must be an object';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_receipt) field_name
    where field_name not in (
      'purchaseRequestId', 'poNumber', 'department', 'receivedDate', 'receiverName', 'note'
    )
  ) then
    raise exception using errcode = '22023', message = 'unexpected goods receipt field';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'goods receipt must have at least one line';
  end if;

  parsed_received_date := (p_receipt ->> 'receivedDate')::date;

  insert into public.goods_receipts (
    fiscal_year,
    purchase_request_id,
    po_number,
    department,
    received_date,
    receiver_name,
    received_by,
    status,
    note,
    created_by,
    updated_by
  )
  values (
    extract(year from parsed_received_date)::integer + 543
      + case when extract(month from parsed_received_date) >= 10 then 1 else 0 end,
    nullif(p_receipt ->> 'purchaseRequestId', '')::uuid,
    nullif(btrim(coalesce(p_receipt ->> 'poNumber', '')), ''),
    btrim(p_receipt ->> 'department'),
    parsed_received_date,
    btrim(p_receipt ->> 'receiverName'),
    p_actor_id,
    'draft',
    nullif(btrim(coalesce(p_receipt ->> 'note', '')), ''),
    p_actor_id,
    p_actor_id
  )
  returning * into created_receipt;

  for line in select * from jsonb_array_elements(p_items)
  loop
    line_index := line_index + 1;

    insert into public.goods_receipt_items (
      goods_receipt_id,
      line_number,
      inventory_item_id,
      lot_number,
      expiry_date,
      quantity,
      unit,
      storage_location
    )
    values (
      created_receipt.id,
      line_index,
      (line ->> 'inventoryItemId')::uuid,
      btrim(line ->> 'lotNumber'),
      nullif(line ->> 'expiryDate', '')::date,
      (line ->> 'quantity')::numeric,
      btrim(line ->> 'unit'),
      nullif(btrim(coalesce(line ->> 'storageLocation', '')), '')
    );
  end loop;

  return created_receipt;
end
$function$;

revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb) from public;
revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb) from anon;
revoke execute on function public.create_goods_receipt(uuid, jsonb, jsonb) from authenticated;
grant execute on function public.create_goods_receipt(uuid, jsonb, jsonb) to service_role;

-- Recording the image is separate from posting so an upload failure leaves the
-- draft intact and creates no stock.
create or replace function public.set_goods_receipt_image(
  p_receipt_id uuid,
  p_actor_id uuid,
  p_po_image_path text
)
returns public.goods_receipts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  updated_receipt public.goods_receipts%rowtype;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  if nullif(btrim(coalesce(p_po_image_path, '')), '') is null then
    raise exception using errcode = '23514', message = 'PO image path is required';
  end if;

  update public.goods_receipts
  set po_image_path = btrim(p_po_image_path),
      updated_by = p_actor_id
  where id = p_receipt_id
  returning * into updated_receipt;

  if not found then
    raise exception using errcode = '23503', message = 'goods receipt not found';
  end if;

  return updated_receipt;
end
$function$;

revoke execute on function public.set_goods_receipt_image(uuid, uuid, text) from public;
revoke execute on function public.set_goods_receipt_image(uuid, uuid, text) from anon;
revoke execute on function public.set_goods_receipt_image(uuid, uuid, text) from authenticated;
grant execute on function public.set_goods_receipt_image(uuid, uuid, text) to service_role;

create or replace function public.post_goods_receipt(
  p_receipt_id uuid,
  p_actor_id uuid
)
returns public.goods_receipts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  locked_receipt public.goods_receipts%rowtype;
  posted_receipt public.goods_receipts%rowtype;
  line public.goods_receipt_items%rowtype;
  target_lot_id uuid;
begin
  perform public.assert_stock_officer_actor(p_actor_id);

  -- Lock first, then re-read status under the lock. Checking before locking
  -- would let two officers both see 'draft' and both post.
  select *
  into locked_receipt
  from public.goods_receipts receipt
  where receipt.id = p_receipt_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'goods receipt not found';
  end if;

  if locked_receipt.status <> 'draft' then
    raise exception using
      errcode = '55000',
      message = format('goods receipt is %s and cannot be posted', locked_receipt.status);
  end if;

  for line in
    select *
    from public.goods_receipt_items item
    where item.goods_receipt_id = p_receipt_id
    order by item.line_number
  loop
    -- Receiving a lot that already exists adds to it rather than rewriting its
    -- original quantity, so the received history stays truthful.
    insert into public.inventory_lots (
      inventory_item_id,
      goods_receipt_item_id,
      lot_number,
      expiry_date,
      received_date,
      original_quantity,
      storage_location,
      created_by,
      updated_by
    )
    values (
      line.inventory_item_id,
      line.id,
      line.lot_number,
      line.expiry_date,
      locked_receipt.received_date,
      line.quantity,
      line.storage_location,
      p_actor_id,
      p_actor_id
    )
    on conflict (inventory_item_id, lot_number) do update
      set expiry_date = coalesce(public.inventory_lots.expiry_date, excluded.expiry_date),
          storage_location = coalesce(excluded.storage_location, public.inventory_lots.storage_location),
          updated_by = p_actor_id
    returning id into target_lot_id;

    update public.goods_receipt_items
    set inventory_lot_id = target_lot_id
    where id = line.id;

    -- The unique index on (source document, item, lot) absorbs a retry here, so
    -- posting twice cannot create a second movement.
    insert into public.stock_movements (
      inventory_item_id,
      inventory_lot_id,
      movement_type,
      quantity,
      occurred_on,
      source_document_type,
      source_document_id,
      created_by
    )
    values (
      line.inventory_item_id,
      target_lot_id,
      'goods_receipt',
      line.quantity,
      locked_receipt.received_date,
      'goods_receipt',
      p_receipt_id,
      p_actor_id
    )
    on conflict do nothing;
  end loop;

  update public.goods_receipts
  set status = 'posted',
      posted_by = p_actor_id,
      posted_at = now(),
      updated_by = p_actor_id
  where id = p_receipt_id
  returning * into posted_receipt;

  return posted_receipt;
end
$function$;

revoke execute on function public.post_goods_receipt(uuid, uuid) from public;
revoke execute on function public.post_goods_receipt(uuid, uuid) from anon;
revoke execute on function public.post_goods_receipt(uuid, uuid) from authenticated;
grant execute on function public.post_goods_receipt(uuid, uuid) to service_role;

alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;

revoke all on table public.goods_receipts from anon, authenticated;
revoke all on table public.goods_receipt_items from anon, authenticated;

grant select on table public.goods_receipts to authenticated;
grant select on table public.goods_receipt_items to authenticated;

grant select, insert, update, delete on table public.goods_receipts to service_role;
grant select, insert, update, delete on table public.goods_receipt_items to service_role;

drop policy if exists goods_receipts_app_read on public.goods_receipts;
create policy goods_receipts_app_read
on public.goods_receipts for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (profile.ephis_id = '9495' or profile.role = 'Manager')
  )
);

drop policy if exists goods_receipt_items_app_read on public.goods_receipt_items;
create policy goods_receipt_items_app_read
on public.goods_receipt_items for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.deleted_at is null
      and (profile.ephis_id = '9495' or profile.role = 'Manager')
  )
);

-- PO evidence lives in a private bucket. A public bucket would expose every
-- scanned purchase order to anyone holding the URL.
insert into storage.buckets (id, name, public)
values ('lab-stock-po', 'lab-stock-po', false)
on conflict (id) do update set public = false;

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'lab-stock-po';

-- Upsert needs all three of INSERT, SELECT, and UPDATE: without UPDATE a
-- re-upload to the same path fails after the object already exists.
drop policy if exists lab_stock_po_officer_insert on storage.objects;
create policy lab_stock_po_officer_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'lab-stock-po'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'stock_officer')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

drop policy if exists lab_stock_po_app_select on storage.objects;
create policy lab_stock_po_app_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'lab-stock-po'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

drop policy if exists lab_stock_po_officer_update on storage.objects;
create policy lab_stock_po_officer_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'lab-stock-po'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'stock_officer')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
)
with check (
  bucket_id = 'lab-stock-po'
  and exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'stock_officer')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

-- Deliberately no DELETE policy: PO evidence is not removable from the app.

commit;
