begin;

-- A confirmed PR keeps its acknowledgement throughout receiving. The original
-- constraint only recognized completed/reversed, so changing a confirmed PR
-- to partially_received or received was rejected even though the audit fields
-- were correctly populated.
alter table public.purchase_requests
  drop constraint if exists purchase_requests_acknowledgement_check;

alter table public.purchase_requests
  add constraint purchase_requests_acknowledgement_check check (
    (status in ('completed', 'partially_received', 'received', 'reversed'))
      = (acknowledged_by is not null)
    and (acknowledged_by is null) = (acknowledged_at is null)
  );

commit;
