-- supabase/migrations/20260703000002_phase_a_roles.sql

-- ── 1. Add role column ──────────────────────────────────────────────────────
alter table public.house_members
  add column if not exists role text not null default 'member'
  check (role in ('admin', 'member'));

-- Backfill: house creator becomes admin
update public.house_members hm
set role = 'admin'
from public.houses h
where hm.house_id = h.id
  and hm.user_id = h.created_by;

-- ── 2. Chore RLS: replace catch-all with read/write split ───────────────────
drop policy if exists "chores: house members" on public.chores;

drop policy if exists "members read chores" on public.chores;
create policy "members read chores"
  on public.chores for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

drop policy if exists "admins write chores" on public.chores;
create policy "admins write chores"
  on public.chores for insert
  with check (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

drop policy if exists "admins update chores" on public.chores;
create policy "admins update chores"
  on public.chores for update
  using (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  )
  with check (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );
-- No delete policy — archive-only via archived_at.

-- ── 3. Completion insert: restrict to caller's own or unassigned chores ──────
drop policy if exists "completions: insert own" on public.chore_completions;
-- "no completions on archived chores" (restrictive) is intentionally kept.

create policy "completions: insert own"
  on public.chore_completions for insert
  with check (
    completed_by = auth.uid()
    and chore_id in (
      select id from public.chores
      where house_id in (
        select house_id from public.house_members where user_id = auth.uid()
      )
      and archived_at is null
      and (assigned_to = auth.uid() or assigned_to is null)
    )
  );

-- ── 4. Houses: admins can update house name ─────────────────────────────────
drop policy if exists "admins update house" on public.houses;
create policy "admins update house"
  on public.houses for update
  using (
    id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  )
  with check (
    id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ── 5. Self-leave: replace raw delete with RPC ──────────────────────────────
drop policy if exists "house_members: leave" on public.house_members;

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

-- ── 6. Role management RPCs ─────────────────────────────────────────────────
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
