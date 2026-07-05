-- supabase/migrations/20260703000004_phase_a_roles_fix2.sql
--
-- Corrective migration: fixes two RPCs from 20260703000003_phase_a_roles_fix.sql
--
-- Changes:
--   • remove_member: move pg_advisory_xact_lock to BEFORE the role read to
--     close TOCTOU race where a concurrent promotion could bypass last-admin guard.
--   • change_member_role / remove_member: remove dead v_house_id variable
--     (was declared, assigned p_house_id, and used — now uses p_house_id directly).

-- ── change_member_role ───────────────────────────────────────────────────────
create or replace function public.change_member_role(
  p_target_user_id uuid,
  p_house_id        uuid,
  p_new_role        text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller      uuid := auth.uid();
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_new_role not in ('admin', 'member') then raise exception 'invalid role'; end if;

  -- Verify caller is admin of the specified house
  if not exists (
    select 1 from public.house_members
    where house_id = p_house_id and user_id = v_caller and role = 'admin'
  ) then raise exception 'not authorized'; end if;

  if p_new_role = 'member' then
    perform pg_advisory_xact_lock(hashtext(p_house_id::text));
    select count(*) into v_admin_count
    from public.house_members
    where house_id = p_house_id and role = 'admin' and user_id != p_target_user_id;
    if v_admin_count = 0 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  update public.house_members
  set role = p_new_role
  where house_id = p_house_id and user_id = p_target_user_id;
end;
$$;

-- ── remove_member ────────────────────────────────────────────────────────────
create or replace function public.remove_member(
  p_target_user_id uuid,
  p_house_id        uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller      uuid := auth.uid();
  v_target_role text;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.house_members
    where house_id = p_house_id and user_id = v_caller and role = 'admin'
  ) then raise exception 'not authorized'; end if;

  perform pg_advisory_xact_lock(hashtext(p_house_id::text));

  select role into v_target_role
  from public.house_members
  where house_id = p_house_id and user_id = p_target_user_id;

  if v_target_role = 'admin' then
    select count(*) into v_admin_count
    from public.house_members
    where house_id = p_house_id and role = 'admin' and user_id != p_target_user_id;
    if v_admin_count = 0 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  delete from public.house_members
  where house_id = p_house_id and user_id = p_target_user_id;
end;
$$;
