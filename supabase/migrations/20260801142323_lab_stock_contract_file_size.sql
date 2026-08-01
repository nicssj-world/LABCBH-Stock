begin;

-- The frozen legacy portal contains an 18,219,021-byte contract PDF. Keep the
-- bucket private and MIME-restricted, but leave enough headroom for that known
-- legal document and similarly sized replacements.
do $guard$
begin
  if not exists (
    select 1 from storage.buckets where id = 'lab-stock-contracts'
  ) then
    raise exception 'lab-stock-contracts bucket must exist before increasing its file limit';
  end if;
end
$guard$;

update storage.buckets
set file_size_limit = 26214400
where id = 'lab-stock-contracts';

commit;
