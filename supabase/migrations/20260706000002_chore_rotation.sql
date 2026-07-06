-- Add rotation flags
alter table public.houses add column if not exists rotation_enabled boolean not null default false;
alter table public.chores  add column if not exists rotation_enabled boolean not null default false;

-- Function: rotate a chore's assigned_to to the next house member (by join order)
create or replace function public.rotate_chore_assignment(p_chore_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_house_id         uuid;
  v_current_assignee uuid;
  v_chore_rotation   boolean;
  v_house_rotation   boolean;
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

  select rotation_enabled into v_house_rotation
    from public.houses where id = v_house_id;

  if not v_house_rotation then return; end if;

  -- Ordered member list
  select array_agg(user_id order by created_at)
    into v_members
    from public.house_members
   where house_id = v_house_id;

  v_count := coalesce(array_length(v_members, 1), 0);
  if v_count <= 1 then return; end if;

  v_idx := array_position(v_members, v_current_assignee);

  if v_idx is null then
    -- Unassigned or assignee left → pick first member
    v_next_user := v_members[1];
  else
    -- Advance one position, wrapping (arrays are 1-based in PG)
    v_next_user := v_members[(v_idx % v_count) + 1];
  end if;

  update public.chores set assigned_to = v_next_user where id = p_chore_id;
end;
$$;

-- Trigger function called after each completion insert
create or replace function public.on_chore_completed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.rotate_chore_assignment(new.chore_id);
  return new;
end;
$$;

drop trigger if exists rotate_on_completion on public.chore_completions;
create trigger rotate_on_completion
  after insert on public.chore_completions
  for each row execute function public.on_chore_completed();
