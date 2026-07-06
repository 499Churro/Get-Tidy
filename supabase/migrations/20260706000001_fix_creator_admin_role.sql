-- Backfill: any house_member who is the created_by of their house should be admin.
-- Covers accounts created before the code fix that sets role='admin' on createHouse.
update public.house_members hm
set role = 'admin'
from public.houses h
where hm.house_id = h.id
  and hm.user_id = h.created_by
  and hm.role = 'member';
