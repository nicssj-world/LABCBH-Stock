-- Give every active portal user a safe baseline when LABCBH Stock is introduced.
-- Existing membership choices win: this inserts only a missing viewer row and
-- never reactivates a viewer access that an administrator intentionally disabled.
insert into public.lab_stock_memberships (profile_id, role, active)
select profile.id, 'viewer', true
from public.profiles profile
where profile.status = 'active'
  and profile.deleted_at is null
on conflict (profile_id, role) do nothing;
