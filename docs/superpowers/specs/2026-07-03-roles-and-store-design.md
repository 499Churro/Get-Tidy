# Roles & Reward Store — Design Spec

## Goal

Add a flexible role system (admin / member) and a point-based reward store to Tidy. The same three-tab structure is used by all roles; role only controls what actions you can take, not what you can see. Supports both family and roommate contexts.

---

## Decisions Made

| Question | Decision |
|---|---|
| Roles | Flexible — any admin can promote/demote any member |
| Navigation | 3 tabs: Home, Chores, Store. House settings → gear icon (top-right) |
| Child/member view | Same UI as admin, write actions hidden (no + buttons, no edit, no delete) |
| Store redemption | Admin sets per-reward: instant or requires approval |
| Point values | Admin sets custom point value per chore when creating/editing |
| Kid accounts | Standard onboarding (email + house code); parent sets role to member after joining |

---

## Architecture

### Two-phase build

**Phase A — Foundation (no store yet)**
1. Add `role` column to `house_members`
2. Replace House tab with Store tab (empty placeholder for now)
3. Move all house settings content into a gear-icon modal sheet
4. Role-gate write actions in Chores tab and Settings sheet
5. Role management UI in Settings sheet (admin only)

**Phase B — Store**
1. Add `point_value` to `chores`; award points on completion via DB trigger
2. Create `rewards` and `redemptions` tables
3. Store tab: admin CRUD, member browse + redeem
4. Redemption approval flow + push notification to admin

---

## Phase A — Foundation

### Database

**Migration: `add_role_to_house_members`**

```sql
alter table public.house_members
  add column role text not null default 'member'
  check (role in ('admin', 'member'));

-- Backfill: house creator becomes admin
update public.house_members hm
set role = 'admin'
from public.houses h
where hm.house_id = h.id
  and hm.user_id = h.created_by;

-- Drop the existing catch-all chores policy that allows all members full CRUD
-- Confirmed policy name from 20260623000002_rls.sql:
drop policy if exists "chores: house members" on public.chores;

-- All house members can read chores
create policy "members read chores"
  on public.chores for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

-- Only admins can create or edit chores.
-- No delete policy — chore deletion is archive-only (set archived_at = now()).
-- Hard delete is never exposed in the app UI; if needed later it's a maintenance op.
create policy "admins write chores"
  on public.chores for insert
  with check (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

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

-- Tighten chore_completions insert policy.
-- The existing permissive policy "completions: insert own" (created in 20260623000002_rls.sql,
-- last tightened in 20260625000001_tighten_completion_rls.sql) only checks
-- completed_by = auth.uid() and house membership. With points enabled a member
-- could earn points by completing another member's assigned chore.
-- Replace with a policy restricted to chores assigned to the caller or unassigned.
-- Product rule: members can complete their own assigned chores and any unassigned chore.
-- If you later add a "claim" flow for unassigned chores, remove the assigned_to is null branch.
-- DO NOT drop "no completions on archived chores" — it is a RESTRICTIVE policy that provides
-- belt-and-suspenders protection. Keep it in place alongside the new permissive policy.
drop policy if exists "completions: insert own" on public.chore_completions;

create policy "members complete own or unassigned chores"
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

-- Allow admins to update the house name
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

-- Role changes and member removal go through security-definer RPCs (not raw updates).
-- No raw update/delete policy on house_members for role management —
-- last-admin protection is enforced inside the RPCs, not just the UI.

create or replace function public.change_member_role(
  p_target_user_id uuid,
  p_new_role        text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller   uuid := auth.uid();
  v_house_id uuid;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_new_role not in ('admin', 'member') then raise exception 'invalid role'; end if;

  -- Caller must be an admin in the same house as the target
  select hm.house_id into v_house_id
  from public.house_members hm
  where hm.user_id = v_caller and hm.role = 'admin'
    and hm.house_id = (
      select house_id from public.house_members where user_id = p_target_user_id limit 1
    );
  if v_house_id is null then raise exception 'not authorized'; end if;

  -- If demoting an admin, ensure at least one other admin will remain
  if p_new_role = 'member' then
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

create or replace function public.remove_member(p_target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller      uuid := auth.uid();
  v_house_id    uuid;
  v_target_role text;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  -- Caller must be an admin in the same house
  select hm.house_id into v_house_id
  from public.house_members hm
  where hm.user_id = v_caller and hm.role = 'admin'
    and hm.house_id = (
      select house_id from public.house_members where user_id = p_target_user_id limit 1
    );
  if v_house_id is null then raise exception 'not authorized'; end if;

  -- If removing an admin, ensure at least one other admin will remain
  select role into v_target_role
  from public.house_members where house_id = v_house_id and user_id = p_target_user_id;

  if v_target_role = 'admin' then
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
```

-- Self-leave must also be RPC-gated so the last admin cannot abandon the house.
-- The existing "house_members: leave" delete policy (using user_id = auth.uid())
-- must be DROPPED and replaced with leave_house() RPC.
-- Migration must include:
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
  from public.house_members where house_id = p_house_id and user_id = v_caller;
  if not found then raise exception 'not a member of this house'; end if;

  -- Last admin cannot leave
  if v_role = 'admin' then
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
```

The "Leave house" button in `HouseSettingsSheet` calls `leave_house(houseId)` instead of a raw delete. The existing self-leave RLS policy is dropped; no client-side delete on `house_members` is allowed.

`useHouse` already selects `house_members` with `select('*, profile:profiles(*)')` — the wildcard will include `role` once the column is added. No change to the select query is needed.

### Navigation changes (`app/(app)/_layout.tsx`)

Current tabs: `index` (Home), `chores` (Chores), `house` (House)
New tabs: `index` (Home), `chores` (Chores), `store` (Store)

`TAB_CONFIG` changes:
- Remove `house` entry
- Add `store`: `{ label: 'Store', icon: 'storefront' }`

Add a new `app/(app)/store.tsx` screen (Phase A: empty state placeholder with "Coming soon" or a locked-store illustration).

### Gear icon — header addition

Each of the three tab screens (`index.tsx`, `chores.tsx`, `store.tsx`) adds a gear icon (`settings` MaterialIcon) to the top-right of its header area. Tapping it opens `HouseSettingsSheet` as a bottom sheet modal.

The gear icon sits alongside the existing "Welcome back, Alex" greeting in `index.tsx`, and in the header area of `chores.tsx` and `store.tsx`.

### `HouseSettingsSheet` component (`components/house/HouseSettingsSheet.tsx`)

Extracts all content from the current `app/(app)/house.tsx` into a reusable bottom sheet component:

- House name + code + Share Code button
- House goal section (momentum bar + goal editor) — admin only for editing, everyone sees the bar
- Members list
- Notification settings
- Own profile edit (display name, avatar, color)
- Leave house

**Admin-only sections** (hidden from members):
- "Change role" button next to each member in the members list
- House name edit
- Remove member option

**Role change UX**: Admin taps a member → action sheet with options: "Make admin" / "Remove from house". These call `change_member_role(userId, newRole)` and `remove_member(userId)` RPCs respectively. Last-admin protection is enforced server-side inside those RPCs — the app does not need to pre-check.

**Personal goal section**: The `house.tsx` source file contains a personal goal section (goal editor + personal momentum bar). This section is **dropped entirely** and NOT carried over into `HouseSettingsSheet`. Only the house goal section is retained.

### `useHouseRole` hook (`hooks/useHouseRole.ts`)

```ts
// Returns current user's role in their house
function useHouseRole(houseId: string | undefined): {
  role: 'admin' | 'member' | null
  isAdmin: boolean
}
```

Reads from the `house_members` row already fetched by `useHouse`. No extra query needed.

### Role gating in Chores tab (`app/(app)/chores.tsx`)

Current: `isOwner` check (`house?.created_by === session?.user.id`) gates the + button and edit actions.
Change: Replace `isOwner` with `isAdmin` from `useHouseRole`.

- `isAdmin = true` → + FAB visible, chore rows tappable/editable, archive (soft-delete) available
- `isAdmin = false` → read-only list, no + FAB, tapping a chore row does nothing

---

## Phase B — Store

### Database

**Migration: `add_point_value_to_chores`**

```sql
alter table public.chores
  add column point_value integer not null default 10
  check (point_value > 0);
```

**Migration: `create_store_tables`**

```sql
-- Ledger: tracks point earnings and spendings per user
create table public.point_ledger (
  id          uuid primary key default gen_random_uuid(),
  house_id    uuid not null references public.houses(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      integer not null,           -- positive = earned, negative = spent
  reason      text not null check (reason in (
    'chore_completion', 'chore_completion_reversal', 'reward_redemption'
  )),
  chore_id    uuid references public.chores(id) on delete set null,
  reward_id   uuid,                       -- FK constraint added at end of migration after rewards table exists
  created_at  timestamptz not null default now()
);

alter table public.point_ledger enable row level security;
-- Members read only their own ledger rows; admins read all rows in their house
create policy "members read own ledger"
  on public.point_ledger for select
  using (
    user_id = auth.uid()
    or house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );
-- No client-side insert/update/delete policies — all writes go through security definer RPCs/triggers

-- Trigger: award points when a chore is completed
create or replace function public.award_chore_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_house_id  uuid;
  v_points    integer;
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

-- Point reversal on undo is NOT handled by an AFTER DELETE trigger.
-- Reason: cascade deletes (e.g. when a chore is archived) would silently fire
-- the same trigger and corrupt ledger history. This was a known issue with
-- the previous score_ledger design.
--
-- Instead, point reversal is performed inside the existing undo_chore_completion()
-- RPC (supabase/migrations/20260702000007_remove_score_ledger.sql).
-- When Phase B is built, update undo_chore_completion to also insert a
-- 'chore_completion_reversal' row into point_ledger:
--
--   insert into public.point_ledger (house_id, user_id, amount, reason, chore_id)
--   values (v_house_id, v_caller, -v_points, 'chore_completion_reversal', p_chore_id);
--
-- This keeps reversal explicit and intentional only.

-- Rewards: admin-created items in the store
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

-- Redemptions: member requests to claim a reward
create table public.redemptions (
  id                    uuid primary key default gen_random_uuid(),
  house_id              uuid not null references public.houses(id) on delete cascade,
  reward_id             uuid not null references public.rewards(id) on delete cascade,
  user_id               uuid not null references public.profiles(id) on delete cascade,
  status                text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  -- Snapshot reward details at time of request so retroactive edits don't change what was approved
  point_cost_at_request integer not null,
  reward_name_snapshot  text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

alter table public.redemptions enable row level security;
-- Members read own rows; admins read all rows in their house
create policy "members read own redemptions"
  on public.redemptions for select
  using (user_id = auth.uid() or house_id in (
    select house_id from public.house_members
    where user_id = auth.uid() and role = 'admin'
  ));
-- No client insert or update policies — all redemption creation and status changes
-- go through security definer RPCs (redeem_reward, approve_redemption, deny_redemption)

-- FK: point_ledger.reward_id → rewards (placed here after both tables exist)
alter table public.point_ledger
  add constraint point_ledger_reward_id_fkey
  foreign key (reward_id) references public.rewards(id) on delete set null;
```

**RPC: `get_point_balance`**

```sql
create or replace function public.get_point_balance(p_house_id uuid)
returns integer language sql security invoker set search_path = public as $$
  select coalesce(sum(amount), 0)::integer
  from public.point_ledger
  where house_id = p_house_id and user_id = auth.uid();
$$;
```

**RPC: `redeem_reward`**

Atomically checks balance, deducts points (if instant), inserts redemption row. Uses `security definer` so the point_ledger insert bypasses the member-facing RLS (no client insert policy needed on point_ledger).

```sql
create or replace function public.redeem_reward(p_reward_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller    uuid := auth.uid();
  v_reward    record;
  v_balance   integer;
  v_is_member boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_reward from public.rewards
  where id = p_reward_id and active = true;
  if not found then raise exception 'reward not found'; end if;

  -- Verify caller is a member of the reward's house
  select exists(
    select 1 from public.house_members
    where house_id = v_reward.house_id and user_id = v_caller
  ) into v_is_member;
  if not v_is_member then raise exception 'not a member of this house'; end if;

  -- Advisory lock per (user_id, house_id) to prevent concurrent double-spend
  perform pg_advisory_xact_lock(
    hashtext(v_caller::text || v_reward.house_id::text)
  );

  select get_point_balance(v_reward.house_id) into v_balance;
  if v_balance < v_reward.point_cost then
    return jsonb_build_object('error', 'insufficient_points');
  end if;

  -- Snapshot reward details at time of request
  insert into public.redemptions (
    house_id, reward_id, user_id, status,
    point_cost_at_request, reward_name_snapshot
  )
  values (
    v_reward.house_id, p_reward_id, v_caller,
    case when v_reward.requires_approval then 'pending' else 'approved' end,
    v_reward.point_cost, v_reward.name
  );

  -- Deduct immediately for instant rewards; approval-required rewards deduct on approval
  if not v_reward.requires_approval then
    insert into public.point_ledger (house_id, user_id, amount, reason, reward_id)
    values (v_reward.house_id, v_caller, -v_reward.point_cost, 'reward_redemption', p_reward_id);
  end if;

  return jsonb_build_object('status',
    case when v_reward.requires_approval then 'pending' else 'approved' end);
end;
$$;
```

**RPC: `approve_redemption`**

Called by the admin when approving a pending redemption. Atomically verifies the caller is an admin, flips status to `approved`, and deducts points from the member's ledger. Uses `security definer` to write to point_ledger.

```sql
create or replace function public.approve_redemption(p_redemption_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller      uuid := auth.uid();
  v_redemption  record;
  v_is_admin    boolean;
  v_balance     integer;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  -- Lock the redemption row first (FOR UPDATE) so concurrent approve/deny calls
  -- serialize here. One will read 'pending'; the other will read the already-updated
  -- status and raise 'not pending' before doing any work.
  select * into v_redemption from public.redemptions
  where id = p_redemption_id
  for update;
  if not found or v_redemption.status <> 'pending' then
    raise exception 'redemption not found or not pending';
  end if;

  select exists(
    select 1 from public.house_members
    where house_id = v_redemption.house_id and user_id = v_caller and role = 'admin'
  ) into v_is_admin;
  if not v_is_admin then raise exception 'not an admin'; end if;

  -- Advisory lock per (member user_id, house_id) prevents concurrent redeem_reward
  -- calls from the same member racing with this approval and double-spending.
  perform pg_advisory_xact_lock(
    hashtext(v_redemption.user_id::text || v_redemption.house_id::text)
  );

  -- Check the MEMBER's balance (not the admin's). get_point_balance() uses auth.uid(),
  -- which here is the admin — so query point_ledger directly for the member.
  select coalesce(sum(amount), 0)::integer into v_balance
  from public.point_ledger
  where house_id = v_redemption.house_id
    and user_id = v_redemption.user_id;
  if v_balance < v_redemption.point_cost_at_request then
    return jsonb_build_object('error', 'insufficient_points');
  end if;

  update public.redemptions
  set status = 'approved', resolved_at = now(), updated_at = now()
  where id = p_redemption_id;

  -- Deduct using snapshotted cost, not the reward's current point_cost
  insert into public.point_ledger (house_id, user_id, amount, reason, reward_id)
  values (v_redemption.house_id, v_redemption.user_id, -v_redemption.point_cost_at_request,
          'reward_redemption', v_redemption.reward_id);

  return jsonb_build_object('status', 'approved');
end;
$$;

create or replace function public.deny_redemption(p_redemption_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller     uuid := auth.uid();
  v_redemption record;
  v_is_admin   boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  -- Row-level lock prevents a concurrent approve from racing with this deny
  select * into v_redemption from public.redemptions
  where id = p_redemption_id
  for update;
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
```

The admin UI calls `approve_redemption` / `deny_redemption` instead of a raw `update`. No direct writes to `point_ledger` from the client. No direct updates to `redemptions` from the client — `admins update redemptions` policy does not exist.

### New files

| File | Purpose |
|---|---|
| `app/(app)/store.tsx` | Store tab screen |
| `components/house/HouseSettingsSheet.tsx` | Extracted house settings as bottom sheet |
| `hooks/useHouseRole.ts` | Returns current user's role + isAdmin boolean |
| `hooks/usePointBalance.ts` | Subscribes to `point_ledger` for current user's balance |
| `hooks/useRewards.ts` | Fetches rewards list for the house |
| `hooks/useRedemptions.ts` | Fetches pending redemptions (admin: all; member: own) |

### Modified files

| File | Change |
|---|---|
| `app/(app)/_layout.tsx` | Replace `house` tab with `store`; add `TAB_CONFIG` entry for store |
| `app/(app)/index.tsx` | Add gear icon to header; pass `isAdmin` to any admin-only home UI |
| `app/(app)/chores.tsx` | Replace `isOwner` with `isAdmin`; add `point_value` field to AddChoreSheet |
| `app/(app)/house.tsx` | Delete — content moves to `HouseSettingsSheet` |
| `components/chores/AddChoreSheet.tsx` | Add point value input (number field, default 10) |
| `types/database.ts` | Add `Reward`, `Redemption`, `PointLedger` interfaces; add `role` to `HouseMember` |

### Store tab screens

**Member view (browse)**
- Point balance chip at top ("🪙 120 pts")
- Scrollable list of active rewards: emoji, name, point cost, instant/approval badge
- Tap reward → confirm sheet → calls `redeem_reward` RPC
  - Instant: immediate success toast
  - Needs approval: "Request sent! Waiting for approval 🙏" toast

**Admin view (manage)**
- Same list with an edit (✏️) icon on each reward row
- "+ Add Reward" button at top right
- "Pending approvals" section above the list when redemptions are waiting
  - Each pending: member name, reward name, approve (✓) / deny (✕) buttons
  - Approving calls `approve_redemption(id)` RPC; denying calls `deny_redemption(id)` RPC — both are security definer and handle the ledger write atomically

**Add/Edit reward sheet**
- Fields: name (text), emoji (emoji picker or text input), point cost (number), requires approval (toggle)
- Admin-only, triggered by + button or edit icon

**Reward deletion**: Never hard-delete a reward row. Set `active = false` instead. This keeps `reward_id` FKs on `redemptions` and `point_ledger` intact so history remains meaningful. Inactive rewards are hidden from the member browse view and from the admin list (or shown greyed-out with a restore option).

### Point balance display

- `index.tsx` (Home tab): member's own balance shown in the avatar badge area — replaces the current `done/total` badge when the store is active (Phase B only). Or shown as a small chip below the avatar.
- `store.tsx`: always shown at top of store screen.

### Push notifications

When a member submits an approval-required redemption, send a push notification to all admins in the house using the existing `push_token` on `profiles`. This reuses the existing Edge Function pattern already in the codebase.

---

## What stays the same

- House goal (momentum bar in settings sheet and home header strip)
- Personal goal — removed (already removed in prior session)
- Onboarding flow — unchanged
- Chore scheduling, frequency, assigned_to — unchanged

## What changes in existing RLS

- `chores`: existing `"chores: house members"` catch-all policy is **dropped**; replaced with read-only for all members, insert/update for admins only; no delete policy (archive via update only)
- `chore_completions`: `"completions: insert own"` permissive insert policy is **dropped** and recreated with `assigned_to = auth.uid() or assigned_to is null` restriction; `"no completions on archived chores"` restrictive policy is **kept** unchanged
- `houses`: new admin-only update policy added
- `house_members`: existing `"house_members: leave"` self-delete policy is **dropped**; replaced by `leave_house()` RPC to enforce last-admin protection on self-leave
- Everything else (houses select/insert, profiles, house_members self-read) — unchanged

**`updated_at` maintenance**: `rewards` and `redemptions` both have an `updated_at` column. The app must set this manually on each update (pass `updated_at: new Date().toISOString()` in the Supabase client call), or add a Postgres trigger per table:
```sql
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
```
Prefer the trigger approach so callers don't need to remember. Add both triggers at the end of the `create_store_tables` migration.

---

## Out of scope

- In-app notifications tab
- Reward history / redemption archive screen
- Point gifting between members
- Recurring rewards (e.g., weekly allowance of points)
