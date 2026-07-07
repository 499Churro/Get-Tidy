-- Security-definer RPC for house creation so the DB always sets role='admin',
-- regardless of client app version.
create or replace function public.create_house(p_name text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_house_id uuid;
begin
  insert into public.houses (name, created_by, code)
  values (p_name, auth.uid(), p_code)
  returning id into v_house_id;

  insert into public.house_members (house_id, user_id, role)
  values (v_house_id, auth.uid(), 'admin');

  return json_build_object('house_id', v_house_id, 'error', null);
exception when others then
  return json_build_object('house_id', null, 'error', sqlerrm);
end;
$$;

-- Backfill any creators still marked member (catches races / old app versions)
update public.house_members hm
set role = 'admin'
from public.houses h
where hm.house_id = h.id
  and hm.user_id = h.created_by
  and hm.role = 'member';
