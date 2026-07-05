-- supabase/migrations/20260703000003_phase_a_roles_fix.sql
--
-- Corrective migration: fixes three RPCs from 20260703000002_phase_a_roles.sql
--
-- Changes:
--   • change_member_role / remove_member: replace limit-1 subquery with explicit
--     p_house_id parameter to prevent wrong-house resolution for multi-house users.
--   • leave_house / change_member_role / remove_member: add pg_advisory_xact_lock
--     before admin-count checks to prevent race condition on last-admin guard.

-- ── leave_house ──────────────────────────────────────────────────────────────
create or replace function public.leave_house(p_house_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller    uuid := auth.uid();
  v_role      text;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select role into v_role
  from public.house_members
  where house_id = p_house_id and user_id = v_caller;
  if not found then raise exception 'not a member of this house'; end if;

  if v_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext(p_house_id::text));
    select count(*) into v_admin_count
    from public.house_members
    where house_id = p_house_id and role = 'admin' and user_id != v_caller;
    if v_admin_count = 0 then
      raise exception 'cannot leave — you are the only admin. Promote another member first.';
    end if;
  end if;

  delete from public.house_members where house_id = p_house_id and user_id = v_caller;
end;
$$;

-- ── change_member_role ───────────────────────────────────────────────────────
create or replace function public.change_member_role(
  p_target_user_id uuid,
  p_house_id        uuid,
  p_new_role        text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller      uuid := auth.uid();
  v_house_id    uuid;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_new_role not in ('admin', 'member') then raise exception 'invalid role'; end if;

  -- Verify caller is admin of the specified house
  if not exists (
    select 1 from public.house_members
    where house_id = p_house_id and user_id = v_caller and role = 'admin'
  ) then raise exception 'not authorized'; end if;
  v_house_id := p_house_id;

  if p_new_role = 'member' then
    perform pg_advisory_xact_lock(hashtext(p_house_id::text));
    select count(*) into v_admin_count
    from public.house_members
    where house_id = v_house_id and role = 'admin' and user_id != p_target_user_id;
    if v_admin_count = 0 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  update public.house_members
  set role = p_new_role
  where house_id = v_house_id and user_id = p_target_user_id;
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
  v_house_id    uuid;
  v_target_role text;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.house_members
    where house_id = p_house_id and user_id = v_caller and role = 'admin'
  ) then raise exception 'not authorized'; end if;
  v_house_id := p_house_id;

  select role into v_target_role
  from public.house_members
  where house_id = v_house_id and user_id = p_target_user_id;

  if v_target_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext(p_house_id::text));
    select count(*) into v_admin_count
    from public.house_members
    where house_id = v_house_id and role = 'admin' and user_id != p_target_user_id;
    if v_admin_count = 0 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  delete from public.house_members
  where house_id = v_house_id and user_id = p_target_user_id;
end;
$$;
