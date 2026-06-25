-- Security-definer RPC to join a house by code, bypassing RLS on the houses lookup.
-- A new user cannot SELECT from houses (RLS: only members can read their own house),
-- so we need this to run as the postgres role to find the house by code.
create or replace function public.join_house_by_code(code_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_house_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'Not authenticated.');
  end if;

  -- Look up house by code (runs as postgres, bypasses RLS)
  select id into v_house_id
  from public.houses
  where code = upper(code_input);

  if v_house_id is null then
    return jsonb_build_object('error', 'House not found. Check your code and try again.');
  end if;

  -- Check if user is already a member of any house (unique constraint on user_id)
  if exists (select 1 from public.house_members where user_id = v_user_id) then
    return jsonb_build_object('error', 'You''re already in a house. Leave your current house first.');
  end if;

  -- Insert membership
  insert into public.house_members (house_id, user_id)
  values (v_house_id, v_user_id);

  return jsonb_build_object('house_id', v_house_id, 'error', null);
end;
$$;
