-- supabase/migrations/20260703000006_phase_b_store.sql

-- ── point_ledger ─────────────────────────────────────────────────────────────
create table public.point_ledger (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references public.houses(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     integer not null,
  reason     text not null check (reason in (
    'chore_completion', 'chore_completion_reversal', 'reward_redemption'
  )),
  chore_id   uuid references public.chores(id) on delete set null,
  reward_id  uuid,   -- FK added after rewards table is created below
  created_at timestamptz not null default now()
);

alter table public.point_ledger enable row level security;
create policy "members read own ledger"
  on public.point_ledger for select
  using (
    user_id = auth.uid()
    or house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ── Award points on chore completion ─────────────────────────────────────────
create or replace function public.award_chore_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_house_id uuid;
  v_points   integer;
begin
  select house_id, point_value into v_house_id, v_points
  from public.chores where id = new.chore_id;
  insert into public.point_ledger (house_id, user_id, amount, reason, chore_id)
  values (v_house_id, new.completed_by, v_points, 'chore_completion', new.chore_id);
  return new;
end;
$$;

create trigger trg_award_chore_points
  after insert on public.chore_completions
  for each row execute function public.award_chore_points();

-- ── rewards ──────────────────────────────────────────────────────────────────
create table public.rewards (
  id               uuid primary key default gen_random_uuid(),
  house_id         uuid not null references public.houses(id) on delete cascade,
  created_by       uuid not null references public.profiles(id),
  name             text not null,
  emoji            text not null default '🎁',
  point_cost       integer not null check (point_cost > 0),
  requires_approval boolean not null default false,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.rewards enable row level security;
create policy "house members read rewards"
  on public.rewards for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));
create policy "admins manage rewards"
  on public.rewards for all
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

-- ── redemptions ───────────────────────────────────────────────────────────────
create table public.redemptions (
  id                    uuid primary key default gen_random_uuid(),
  house_id              uuid not null references public.houses(id) on delete cascade,
  reward_id             uuid not null references public.rewards(id) on delete cascade,
  user_id               uuid not null references public.profiles(id) on delete cascade,
  status                text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  point_cost_at_request integer not null,
  reward_name_snapshot  text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

alter table public.redemptions enable row level security;
create policy "members read own redemptions"
  on public.redemptions for select
  using (user_id = auth.uid() or house_id in (
    select house_id from public.house_members
    where user_id = auth.uid() and role = 'admin'
  ));

-- ── FK: point_ledger.reward_id → rewards (both tables now exist) ──────────────
alter table public.point_ledger
  add constraint point_ledger_reward_id_fkey
  foreign key (reward_id) references public.rewards(id) on delete set null;

-- ── get_point_balance RPC ─────────────────────────────────────────────────────
create or replace function public.get_point_balance(p_house_id uuid)
returns integer language sql security invoker set search_path = public as $$
  select coalesce(sum(amount), 0)::integer
  from public.point_ledger
  where house_id = p_house_id and user_id = auth.uid();
$$;

-- ── redeem_reward RPC ─────────────────────────────────────────────────────────
create or replace function public.redeem_reward(p_reward_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller    uuid := auth.uid();
  v_reward    record;
  v_balance   integer;
  v_is_member boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_reward from public.rewards where id = p_reward_id and active = true;
  if not found then raise exception 'reward not found'; end if;

  select exists(
    select 1 from public.house_members
    where house_id = v_reward.house_id and user_id = v_caller
  ) into v_is_member;
  if not v_is_member then raise exception 'not a member of this house'; end if;

  perform pg_advisory_xact_lock(hashtext(v_caller::text || v_reward.house_id::text));

  select get_point_balance(v_reward.house_id) into v_balance;
  if v_balance < v_reward.point_cost then
    return jsonb_build_object('error', 'insufficient_points');
  end if;

  insert into public.redemptions (
    house_id, reward_id, user_id, status,
    point_cost_at_request, reward_name_snapshot
  ) values (
    v_reward.house_id, p_reward_id, v_caller,
    case when v_reward.requires_approval then 'pending' else 'approved' end,
    v_reward.point_cost, v_reward.name
  );

  if not v_reward.requires_approval then
    insert into public.point_ledger (house_id, user_id, amount, reason, reward_id)
    values (v_reward.house_id, v_caller, -v_reward.point_cost, 'reward_redemption', p_reward_id);
  end if;

  return jsonb_build_object('status',
    case when v_reward.requires_approval then 'pending' else 'approved' end);
end;
$$;

-- ── approve_redemption RPC ────────────────────────────────────────────────────
create or replace function public.approve_redemption(p_redemption_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller     uuid := auth.uid();
  v_redemption record;
  v_is_admin   boolean;
  v_balance    integer;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_redemption from public.redemptions
  where id = p_redemption_id for update;
  if not found or v_redemption.status <> 'pending' then
    raise exception 'redemption not found or not pending';
  end if;

  select exists(
    select 1 from public.house_members
    where house_id = v_redemption.house_id and user_id = v_caller and role = 'admin'
  ) into v_is_admin;
  if not v_is_admin then raise exception 'not an admin'; end if;

  perform pg_advisory_xact_lock(
    hashtext(v_redemption.user_id::text || v_redemption.house_id::text)
  );

  -- Check the MEMBER's balance (not the admin's)
  select coalesce(sum(amount), 0)::integer into v_balance
  from public.point_ledger
  where house_id = v_redemption.house_id and user_id = v_redemption.user_id;
  if v_balance < v_redemption.point_cost_at_request then
    return jsonb_build_object('error', 'insufficient_points');
  end if;

  update public.redemptions
  set status = 'approved', resolved_at = now(), updated_at = now()
  where id = p_redemption_id;

  insert into public.point_ledger (house_id, user_id, amount, reason, reward_id)
  values (v_redemption.house_id, v_redemption.user_id,
          -v_redemption.point_cost_at_request, 'reward_redemption', v_redemption.reward_id);

  return jsonb_build_object('status', 'approved');
end;
$$;

-- ── deny_redemption RPC ───────────────────────────────────────────────────────
create or replace function public.deny_redemption(p_redemption_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller     uuid := auth.uid();
  v_redemption record;
  v_is_admin   boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_redemption from public.redemptions
  where id = p_redemption_id for update;
  if not found or v_redemption.status <> 'pending' then
    raise exception 'redemption not found or not pending';
  end if;

  select exists(
    select 1 from public.house_members
    where house_id = v_redemption.house_id and user_id = v_caller and role = 'admin'
  ) into v_is_admin;
  if not v_is_admin then raise exception 'not an admin'; end if;

  update public.redemptions
  set status = 'denied', resolved_at = now(), updated_at = now()
  where id = p_redemption_id;

  return jsonb_build_object('status', 'denied');
end;
$$;

-- ── updated_at auto-maintenance triggers ──────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger set_rewards_updated_at
  before update on public.rewards
  for each row execute function public.set_updated_at();

create trigger set_redemptions_updated_at
  before update on public.redemptions
  for each row execute function public.set_updated_at();
