-- Simplify: rotation fires based on chore flag only, not the house flag.
-- The house toggle in settings remains as a master enable/disable, but the
-- per-chore flag is now the authoritative gate so the toggle always works.
create or replace function public.rotate_chore_assignment(p_chore_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_house_id         uuid;
  v_current_assignee uuid;
  v_chore_rotation   boolean;
  v_members          uuid[];
  v_count            int;
  v_idx              int;
  v_next_user        uuid;
begin
  select house_id, assigned_to, rotation_enabled
    into v_house_id, v_current_assignee, v_chore_rotation
    from public.chores
   where id = p_chore_id;

  if not found or not v_chore_rotation then return; end if;

  select array_agg(user_id order by created_at)
    into v_members
    from public.house_members
   where house_id = v_house_id;

  v_count := coalesce(array_length(v_members, 1), 0);
  if v_count <= 1 then return; end if;

  v_idx := array_position(v_members, v_current_assignee);

  if v_idx is null then
    v_next_user := v_members[1];
  else
    v_next_user := v_members[(v_idx % v_count) + 1];
  end if;

  update public.chores set assigned_to = v_next_user where id = p_chore_id;
end;
$$;
