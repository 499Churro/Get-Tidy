# Gamification Phase 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the gamification data layer and hooks — no UI. After this plan, the app should track contribution points, personal streaks, and house momentum correctly, with all edge cases handled.

**Architecture:** Five sequential checkpoints. Each checkpoint depends on the previous one and must be completed in order. Each checkpoint is individually verifiable before the next begins. UI comes in Phase 2b (separate plan).

**Tech Stack:** Supabase Postgres (migrations), Deno Edge Functions (TypeScript), React Native hooks (TypeScript), Jest

**Spec:** `docs/superpowers/specs/2026-06-30-gamification-v2-encouraging.md`

---

## Pre-Flight Checklist (do before Checkpoint 1)

- [ ] **Check for a dirty worktree**

```bash
git status
```

If there are untracked or modified files unrelated to gamification (app icons, reminder changes, etc.), commit or stash them first. This plan commits at each checkpoint — mixing unrelated changes into gamification commits makes rollback and bisect unreliable.

```bash
# Option A: commit unrelated changes first
git add <unrelated files>
git commit -m "chore: stash pre-gamification app state"

# Option B: stash and restore after
git stash push -m "pre-gamification work in progress"
```

- [ ] **Verify `supabase db push` target**

`supabase db push` applies migrations to the **linked remote project**, not a local database. Confirm the linked project is the correct Supabase instance (not a production database if you are testing):

```bash
supabase status
```

If working against a local stack (`supabase start`), use `supabase db reset` or `supabase db push --local` depending on your setup.

---

## Critical Rules for Implementers

Read these before writing a single line:

1. **`is_chore_active` must be date-aware for `archived_at`.** Return false only when `evaluationDate >= archivedDate`. Dates before archive must evaluate normally.

2. **Momentum Edge Function fetches `archived_at is null OR archived_at >= month_start`.** NOT just `archived_at is null`. Archived chores whose completions fall within the month must still count.

3. **Overdue bonus (+15) applies only to one-time chores** (`due_date IS NOT NULL`). Recurring chores always get +10.

4. **`undo_chore_completion` RPC, not a direct delete.** The `undoMarkDone` path in `useChores.ts` must call the RPC. No direct `.delete()` on `chore_completions`.

5. **No `AFTER DELETE` trigger on `chore_completions`.** Cascade deletes must not affect `score_ledger`.

6. **`deleteChore` becomes archive.** Set `archived_at = now()`. Never hard-delete a chore from the client.

7. **`get-house-momentum` must verify JWT + house membership** before any service-role data access.

---

## Checkpoint 1: Schema + Archive Behavior

**Files:**
- Create: `supabase/migrations/20260630000001_add_archived_at.sql`
- Modify: `supabase/functions/_shared/is-chore-active.ts`
- Modify: `hooks/useChores.ts`
- Modify: `types/database.ts`
- Create: `__tests__/lib/isChoreActive.archive.test.ts`

### Task 1.1 — Migration: `archived_at` column

- [ ] **Write migration**

```sql
-- supabase/migrations/20260630000001_add_archived_at.sql
alter table public.chores
  add column if not exists archived_at timestamptz default null;

-- Index for the momentum Edge Function query (archived_at >= month_start)
create index if not exists chores_archived_at_idx
  on public.chores (archived_at)
  where archived_at is not null;
```

- [ ] **Apply migration locally**

```bash
supabase db push
```

Expected: no errors, `chores` table now has `archived_at` column.

- [ ] **Verify column exists**

```bash
supabase db diff
```

Expected: clean diff (migration already applied).

---

### Task 1.2 — Update `is_chore_active` with date-aware archive guard

**Context:** `supabase/functions/_shared/is-chore-active.ts` currently has no knowledge of `archived_at`. It must be updated to return false for evaluation dates on or after the archive date, but evaluate normally for dates before.

The existing `ChoreRow` interface also lacks `biweekly`, `monthly`, and `archived_at` — these need to be added.

- [ ] **Write the failing tests first**

Create `__tests__/lib/isChoreActive.archive.test.ts`:

```ts
import { isChoreActiveOnDate } from '../../supabase/functions/_shared/is-chore-active'

const base = {
  due_date: null,
  frequency: 'daily' as const,
  days_of_week: null,
  created_at: '2026-06-01T00:00:00Z',
  archived_at: null,
}

describe('archived_at date-aware guard', () => {
  it('returns true for a date before archived_at', () => {
    const chore = { ...base, archived_at: '2026-06-20T00:00:00Z' }
    expect(isChoreActiveOnDate(chore, '2026-06-19', 4)).toBe(true)
  })

  it('returns false for a date equal to archived_at date', () => {
    const chore = { ...base, archived_at: '2026-06-20T00:00:00Z' }
    expect(isChoreActiveOnDate(chore, '2026-06-20', 5)).toBe(false)
  })

  it('returns false for a date after archived_at', () => {
    const chore = { ...base, archived_at: '2026-06-20T00:00:00Z' }
    expect(isChoreActiveOnDate(chore, '2026-06-25', 3)).toBe(false)
  })

  it('returns true when archived_at is null', () => {
    expect(isChoreActiveOnDate(base, '2026-06-25', 3)).toBe(true)
  })
})
```

- [ ] **Run tests — verify they fail**

```bash
npx jest isChoreActive.archive --no-coverage
```

Expected: 2–3 failures (function doesn't know about `archived_at` yet).

- [ ] **Update `is-chore-active.ts`**

```ts
export interface ChoreRow {
  due_date: string | null
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  days_of_week: number[] | null
  created_at: string
  archived_at?: string | null  // ISO timestamptz string
}

export function isChoreActiveOnDate(
  chore: ChoreRow,
  localDate: string,      // YYYY-MM-DD
  localDayOfWeek: number  // 0=Sun…6=Sat
): boolean {
  // Archive guard — date-aware. Dates before archive evaluate normally.
  if (chore.archived_at) {
    const archivedDate = chore.archived_at.slice(0, 10)
    if (localDate >= archivedDate) return false
  }

  if (chore.due_date) return chore.due_date === localDate
  if (chore.created_at.slice(0, 10) > localDate) return false

  if (chore.frequency === 'daily') return true

  if (chore.frequency === 'weekly') {
    if (chore.days_of_week?.length) return chore.days_of_week.includes(localDayOfWeek)
    return true // legacy: no days_of_week means all week
  }

  if (chore.frequency === 'biweekly') {
    if (!chore.days_of_week?.length || !chore.days_of_week.includes(localDayOfWeek)) return false
    const creationMonday = getMondayOfWeek(chore.created_at.slice(0, 10))
    const currentMonday = getMondayOfWeek(localDate)
    const weeksDiff = Math.round(
      (new Date(currentMonday).getTime() - new Date(creationMonday).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
    )
    return weeksDiff >= 0 && weeksDiff % 2 === 0
  }

  if (chore.frequency === 'monthly') {
    if (!chore.days_of_week?.length || !chore.days_of_week.includes(localDayOfWeek)) return false
    const date = new Date(localDate + 'T00:00:00Z')
    const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    const firstDow = firstOfMonth.getUTCDay()
    const daysUntil = (localDayOfWeek - firstDow + 7) % 7
    const firstOccurrence = new Date(firstOfMonth)
    firstOccurrence.setUTCDate(1 + daysUntil)
    return date.getUTCDate() === firstOccurrence.getUTCDate()
  }

  return false
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Run tests — verify they pass**

```bash
npx jest isChoreActive.archive --no-coverage
```

Expected: all 4 tests pass.

- [ ] **Run full test suite — verify no regressions**

```bash
npx jest --no-coverage
```

Expected: all existing tests still pass.

- [ ] **Commit**

```bash
git add supabase/migrations/20260630000001_add_archived_at.sql supabase/functions/_shared/is-chore-active.ts __tests__/lib/isChoreActive.archive.test.ts
git commit -m "feat(gamification): archived_at column + date-aware is_chore_active"
```

---

### Task 1.3 — Update `types/database.ts`

- [ ] **Add `archived_at` to `Chore` interface**

In `types/database.ts`, add to the `Chore` interface:

```ts
archived_at: string | null
```

After `reminder_time: string | null`.

- [ ] **Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. (Callers that spread `Chore` will pick up the new field automatically.)

- [ ] **Fix any test fixtures** — add `archived_at: null` to `baseChore` in `__tests__/lib/chores.test.ts`.

- [ ] **Run tests**

```bash
npx jest --no-coverage
```

Expected: all pass.

- [ ] **Commit**

```bash
git add types/database.ts __tests__/lib/chores.test.ts
git commit -m "feat(gamification): add archived_at to Chore type"
```

---

### Task 1.4 — `deleteChore` becomes archive in `useChores.ts`

- [ ] **Update `deleteChore` in `hooks/useChores.ts`**

Replace the hard-delete with an archive patch:

```ts
async function deleteChore(choreId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('chores')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', choreId)
  if (!error) {
    cancelChoreNotifications(choreId).catch(() => {})
    await fetchAll()
  }
  return { error: error?.message ?? null }
}
```

- [ ] **Update `fetchAll` to filter archived chores from UI**

In the `fetchAll` query:

```ts
const { data: choreData } = await supabase
  .from('chores')
  .select('*, assigned_profile:profiles!assigned_to(*)')
  .eq('house_id', houseId)
  .is('archived_at', null)   // ← add this line
```

- [ ] **Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add hooks/useChores.ts
git commit -m "feat(gamification): deleteChore archives instead of hard-deletes"
```

---

### Task 1.5 — Update notification Edge Functions to select `archived_at`

`is_chore_active` now returns false for archived chores on or after their archive date. But if `notify-due-today` and `notify-overdue` do not select `archived_at` in their chore queries, the field arrives as `undefined` — and the archive guard is silently skipped. Archived chores could still fire notifications.

- [ ] **Update `notify-due-today/index.ts` chore select**

Find the chores query and add `archived_at` to the select:

```ts
const { data: chores } = await supabase
  .from('chores')
  .select('id, name, frequency, due_date, days_of_week, created_at, archived_at, reminder_time')
  .eq('assigned_to', profile.id)
  .or(`archived_at.is.null,archived_at.gte.${todayLocal}`)
```

The `.or()` filter is a fast server-side pre-filter. `isChoreActiveOnDate` then applies the precise date-aware guard. Together they ensure archived chores never produce notifications.

- [ ] **Apply the same change to `notify-overdue/index.ts`** (if that function exists — check `supabase/functions/`).

- [ ] **Deploy updated functions**

```bash
supabase functions deploy notify-due-today
# If notify-overdue exists:
supabase functions deploy notify-overdue
```

- [ ] **Verify: archive a chore, confirm no notification fires at its reminder time** (manual test in the app with a test chore).

- [ ] **Commit**

```bash
# Stage notify-due-today (always changed)
git add supabase/functions/notify-due-today/index.ts

# Stage notify-overdue only if it was modified
[ -f supabase/functions/notify-overdue/index.ts ] && \
  git add supabase/functions/notify-overdue/index.ts

git commit -m "fix(notifications): select archived_at and filter archived chores"
```

---

## Checkpoint 2: Scoring Foundation

**Files:**
- Create: `supabase/migrations/20260630000002_score_ledger.sql`
- Create: `__tests__/scoring.test.sql` (or use Supabase pgTAP if available — otherwise document as manual verification steps)
- Modify: `hooks/useChores.ts` (`undoMarkDone`)

### Task 2.1 — Migration: `score_ledger`, award trigger, undo RPC

- [ ] **Write migration**

```sql
-- supabase/migrations/20260630000002_score_ledger.sql

-- ─── score_ledger ────────────────────────────────────────────────────────────
create table if not exists public.score_ledger (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  house_id    uuid not null references public.houses(id) on delete cascade,
  event_type  text not null check (event_type in (
                'chore_completion',
                'chore_completion_reversal',
                'streak_bonus'           -- reserved, not used in Phase 2
              )),
  points      integer not null,
  chore_id    uuid references public.chores(id) on delete set null,
  for_date    date not null,
  created_at  timestamptz not null default now()
);

create index score_ledger_user_date_idx on public.score_ledger (user_id, for_date);
create index score_ledger_house_idx     on public.score_ledger (house_id);

-- RLS
alter table public.score_ledger enable row level security;

-- House members can read all entries for their house
create policy "house members read score_ledger"
  on public.score_ledger for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

-- No client INSERT / UPDATE / DELETE — writes go through triggers and RPCs only

-- Prevent completions on archived chores at the RLS level.
-- IMPORTANT: must be AS RESTRICTIVE. Postgres combines permissive policies with
-- OR, so a plain permissive policy here would be overridden by the existing
-- insert policy and never actually block anything. A restrictive policy is
-- combined with AND — it blocks the row even when other policies permit it.
create policy "no completions on archived chores"
  on public.chore_completions
  as restrictive
  for insert
  with check (
    (select archived_at from public.chores where id = chore_id) is null
  );

-- ─── award_completion_points trigger ─────────────────────────────────────────
-- Belt-and-suspenders: even if the RLS policy is bypassed (service role, trigger
-- on a future table, etc.), the trigger itself will not award points for archived
-- chores. It checks archived_at and skips silently if the chore is archived on
-- new.for_date.
create or replace function public.award_completion_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chore   record;
  v_points  integer;
begin
  -- Load the chore to determine points, house, and archive state
  select due_date, house_id, archived_at
  into v_chore
  from public.chores
  where id = new.chore_id;

  if not found then
    return new; -- chore hard-deleted, skip
  end if;

  -- Skip if chore was archived on or before the completion date
  if v_chore.archived_at is not null
     and new.for_date >= v_chore.archived_at::date then
    return new;
  end if;

  -- Overdue bonus: only for one-time chores (due_date set) completed after due_date
  if v_chore.due_date is not null and new.for_date > v_chore.due_date then
    v_points := 15;
  else
    v_points := 10;
  end if;

  insert into public.score_ledger (user_id, house_id, event_type, points, chore_id, for_date)
  values (new.completed_by, v_chore.house_id, 'chore_completion', v_points, new.chore_id, new.for_date);

  return new;
end;
$$;

create trigger trg_award_completion_points
  after insert on public.chore_completions
  for each row execute function public.award_completion_points();

-- ─── undo_chore_completion RPC ───────────────────────────────────────────────
-- Idempotent: returns silently if completion is already gone.
-- Prevents undoing another user's completion: checks ownership before lock.
-- Uses FOR UPDATE to prevent races between concurrent undo/re-complete calls.
create or replace function public.undo_chore_completion(
  p_chore_id uuid,
  p_for_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion  record;
  v_owner       uuid;
  v_ledger      record;
begin
  -- Check ownership without locking first (fast path for already-undone case)
  select completed_by into v_owner
  from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date;

  -- Idempotent: completion already gone — nothing to do
  if not found then
    return;
  end if;

  -- Ownership check: reject if completion belongs to another user
  if v_owner <> auth.uid() then
    raise exception 'completion belongs to another user';
  end if;

  -- Lock the row to prevent races (re-complete or duplicate undo in flight)
  select * into v_completion
  from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date
    and completed_by = auth.uid()
  for update;

  -- Guard: another concurrent undo already deleted it
  if not found then
    return;
  end if;

  -- Find original award to match reversal amount
  select points, house_id into v_ledger
  from public.score_ledger
  where chore_id = p_chore_id
    and for_date = p_for_date
    and user_id = auth.uid()
    and event_type = 'chore_completion'
  order by created_at desc
  limit 1;

  -- Delete the completion row (no AFTER DELETE trigger on chore_completions — safe)
  delete from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date
    and completed_by = auth.uid();

  -- Insert reversal if an original award exists
  if found then
    insert into public.score_ledger (user_id, house_id, event_type, points, chore_id, for_date)
    values (auth.uid(), v_ledger.house_id, 'chore_completion_reversal', -v_ledger.points, p_chore_id, p_for_date);
  end if;
end;
$$;
```

- [ ] **Apply migration**

```bash
supabase db push
```

Expected: no errors.

- [ ] **Verify trigger, RPC, and archive RLS policy exist**

```sql
-- Trigger exists
select trigger_name from information_schema.triggers
where trigger_name = 'trg_award_completion_points';

-- RPC exists
select routine_name from information_schema.routines
where routine_name = 'undo_chore_completion';

-- Archive completion block policy exists
select policyname from pg_policies
where tablename = 'chore_completions'
  and policyname = 'no completions on archived chores';
```

Expected: all three rows returned.

- [ ] **Verify archived chore cannot be completed** (manual test)

```sql
-- Archive an existing chore
update public.chores set archived_at = now() where id = '<chore_id>';

-- Attempt to insert a completion — should be blocked by RLS
insert into public.chore_completions (chore_id, completed_by, for_date)
values ('<chore_id>', '<user_id>', current_date);
-- Expected: RLS violation error (as the user role, not service role)
```

- [ ] **Manual trigger test — complete a chore, verify score_ledger row**

```sql
-- Find a real chore_id and user_id from your test house
-- Insert a test completion
insert into public.chore_completions (chore_id, completed_by, for_date)
values ('<chore_id>', '<user_id>', current_date);

-- Verify ledger row created
select * from public.score_ledger where chore_id = '<chore_id>';
-- Expected: 1 row, event_type = 'chore_completion', points = 10
```

- [ ] **Manual undo test**

```sql
-- Call RPC as the user (requires auth context — test via client or anon JWT)
select public.undo_chore_completion('<chore_id>', current_date);

-- Verify reversal row
select * from public.score_ledger where chore_id = '<chore_id>' order by created_at;
-- Expected: 2 rows — original +10 and reversal -10
-- Verify completion deleted
select count(*) from public.chore_completions where chore_id = '<chore_id>' and for_date = current_date;
-- Expected: 0
```

- [ ] **Commit**

```bash
git add supabase/migrations/20260630000002_score_ledger.sql
git commit -m "feat(gamification): score_ledger, award trigger, undo RPC"
```

---

### Task 2.2 — Update `undoMarkDone` in `useChores.ts`

- [ ] **Replace direct delete with RPC call**

In `hooks/useChores.ts`, replace `undoMarkDone`:

```ts
async function undoMarkDone(choreId: string): Promise<void> {
  const key = `${choreId}:${selectedDate}`
  if (pendingRef.current.has(key)) return
  pendingRef.current.add(key)

  // Optimistically remove completion from local state
  const snapshot = completions.filter(
    c => c.chore_id === choreId && c.for_date === selectedDate
  )
  setCompletions(prev =>
    prev.filter(c => !(c.chore_id === choreId && c.for_date === selectedDate))
  )

  try {
    const { error } = await supabase.rpc('undo_chore_completion', {
      p_chore_id: choreId,
      p_for_date: selectedDate,
    })
    if (error) {
      // Rollback optimistic update
      setCompletions(prev => [...prev, ...snapshot])
    }
  } catch {
    setCompletions(prev => [...prev, ...snapshot])
  } finally {
    pendingRef.current.delete(key)
  }
}
```

- [ ] **Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Run tests**

```bash
npx jest --no-coverage
```

- [ ] **Commit**

```bash
git add hooks/useChores.ts
git commit -m "feat(gamification): undoMarkDone calls undo_chore_completion RPC"
```

---

## Checkpoint 3: Streak Foundation

**Files:**
- Create: `supabase/migrations/20260630000003_user_streaks.sql`
- Create: `supabase/functions/evaluate-streaks/index.ts`

### Task 3.1 — Migration: `user_streaks`

- [ ] **Write migration**

```sql
-- supabase/migrations/20260630000003_user_streaks.sql

create table if not exists public.user_streaks (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  current_streak   integer not null default 0,
  longest_streak   integer not null default 0,
  last_active_date date,
  updated_at       timestamptz not null default now()
);

alter table public.user_streaks enable row level security;

-- Users can only read their own streak (personal, not shared)
create policy "own streak read"
  on public.user_streaks for select
  using (user_id = auth.uid());

-- No client writes — written by evaluate-streaks Edge Function only
```

- [ ] **Apply and verify**

```bash
supabase db push
```

- [ ] **Commit**

```bash
git add supabase/migrations/20260630000003_user_streaks.sql
git commit -m "feat(gamification): user_streaks table with RLS"
```

---

### Task 3.2 — Edge Function: `evaluate-streaks`

**Schedule:** pg_cron daily at `10:00 UTC` (after midnight for all US timezones including Hawaii UTC-10).

- [ ] **Create function**

```ts
// supabase/functions/evaluate-streaks/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isChoreActiveOnDate } from '../_shared/is-chore-active.ts'

serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Fetch all profiles that are members of any house — not filtered by push_token.
  // Streaks are a personal feature and must not depend on notification permissions.
  const { data: members } = await admin
    .from('house_members')
    .select('user_id, profiles(id, timezone)')

  // Deduplicate: a user in multiple houses should only be evaluated once
  const seen = new Set<string>()
  const profiles = (members ?? [])
    .map(m => m.profiles as { id: string; timezone: string } | null)
    .filter((p): p is { id: string; timezone: string } => p !== null && !seen.has(p.id) && seen.add(p.id) !== undefined)

  for (const profile of profiles ?? []) {
    const tz = profile.timezone ?? 'America/Los_Angeles'
    const localNow = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
    const yesterday = new Date(localNow)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)
    const yesterdayDow = yesterday.getDay()

    // Fetch chores assigned to this user that were potentially active yesterday.
    // Include archived chores archived on or after yesterday (date-aware guard in isChoreActiveOnDate).
    const { data: chores } = await admin
      .from('chores')
      .select('id, due_date, frequency, days_of_week, created_at, archived_at')
      .eq('assigned_to', profile.id)
      .or(`archived_at.is.null,archived_at.gte.${yesterdayStr}`)

    const activeChores = (chores ?? []).filter(c =>
      isChoreActiveOnDate(c, yesterdayStr, yesterdayDow)
    )

    // Neutral day — no assigned active chores
    if (activeChores.length === 0) continue

    // Check completions for yesterday
    const choreIds = activeChores.map(c => c.id)
    const { count: completedCount } = await admin
      .from('chore_completions')
      .select('*', { count: 'exact', head: true })
      .in('chore_id', choreIds)
      .eq('for_date', yesterdayStr)

    const { data: streak } = await admin
      .from('user_streaks')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle()

    const current = streak ?? {
      user_id: profile.id,
      current_streak: 0,
      longest_streak: 0,
      last_active_date: null,
    }

    let newStreak: number
    let newLongest = current.longest_streak

    if ((completedCount ?? 0) === activeChores.length) {
      // All assigned chores completed
      const lastActive = current.last_active_date
      const expectedPrev = new Date(yesterday)
      expectedPrev.setDate(expectedPrev.getDate() - 1)
      const expectedPrevStr = expectedPrev.toISOString().slice(0, 10)

      newStreak = lastActive === expectedPrevStr
        ? current.current_streak + 1
        : 1

      newLongest = Math.max(newLongest, newStreak)

      await admin.from('user_streaks').upsert({
        user_id: profile.id,
        current_streak: newStreak,
        longest_streak: newLongest,
        last_active_date: yesterdayStr,
        updated_at: new Date().toISOString(),
      })
    } else {
      // Incomplete — reset streak
      await admin.from('user_streaks').upsert({
        user_id: profile.id,
        current_streak: 0,
        longest_streak: newLongest,
        last_active_date: current.last_active_date,
        updated_at: new Date().toISOString(),
      })
    }
  }

  return new Response('ok', { status: 200 })
})
```

- [ ] **Deploy function**

```bash
supabase functions deploy evaluate-streaks
```

- [ ] **Register pg_cron job** (run in Supabase SQL Editor)

```sql
-- Remove old streak cron if it exists
select cron.unschedule('evaluate-streaks') where exists (
  select 1 from cron.job where jobname = 'evaluate-streaks'
);

-- Schedule at 10:00 UTC daily
select cron.schedule(
  'evaluate-streaks',
  '0 10 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/evaluate-streaks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Verify cron registered**

```sql
select jobname, schedule from cron.job where jobname = 'evaluate-streaks';
```

Expected: `0 10 * * *`.

- [ ] **Commit**

```bash
git add supabase/functions/evaluate-streaks/index.ts
git commit -m "feat(gamification): evaluate-streaks Edge Function, 10:00 UTC daily"
```

---

## Checkpoint 4: House Momentum Foundation

**Files:**
- Create: `supabase/migrations/20260630000004_house_monthly_goals.sql`
- Create: `supabase/functions/get-house-momentum/index.ts`

### Task 4.1 — Migration: `house_monthly_goals`

- [ ] **Write migration**

```sql
-- supabase/migrations/20260630000004_house_monthly_goals.sql

create table if not exists public.house_monthly_goals (
  id           uuid primary key default uuid_generate_v4(),
  house_id     uuid not null references public.houses(id) on delete cascade,
  month        date not null,   -- first day of month: '2026-06-01'
  reward_text  text not null,
  target_pct   integer not null default 90 check (target_pct between 1 and 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (house_id, month)
);

alter table public.house_monthly_goals enable row level security;

-- House members can read goals for their house
create policy "house members read goals"
  on public.house_monthly_goals for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

-- House members can insert/update goals for their house
create policy "house members write goals"
  on public.house_monthly_goals for insert
  with check (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

create policy "house members update goals"
  on public.house_monthly_goals for update
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ))
  with check (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));
```

- [ ] **Apply and verify**

```bash
supabase db push
```

- [ ] **Commit**

```bash
git add supabase/migrations/20260630000004_house_monthly_goals.sql
git commit -m "feat(gamification): house_monthly_goals table with RLS"
```

---

### Task 4.2 — Edge Function: `get-house-momentum`

This is the most complex piece. Read the spec section "Momentum Flow" and the security contract before implementing.

Key rules:
- Fetch `archived_at is null OR archived_at >= month_start` (not just `archived_at is null`)
- On-time for recurring chores = `isChoreActiveOnDate(chore, completion.for_date, dow)` is true
- On-time for one-time chores = `for_date <= due_date` AND `isChoreActiveOnDate` (i.e., `for_date === due_date`)
- Verify JWT and house membership before any data access

- [ ] **Create function**

```ts
// supabase/functions/get-house-momentum/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isChoreActiveOnDate } from '../_shared/is-chore-active.ts'

function dateToYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysInRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T00:00:00Z')
  const last = new Date(end + 'T00:00:00Z')
  while (cur <= last) {
    days.push(dateToYMD(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

serve(async (req) => {
  // ── 1. Verify JWT ──────────────────────────────────────────────────────────
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jwt) return new Response('Unauthorized', { status: 401 })

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  // ── 2. Parse request ───────────────────────────────────────────────────────
  const { house_id, month } = await req.json() as { house_id: string; month: string }
  if (!house_id || !month) return new Response('Bad Request', { status: 400 })

  // ── 3. Verify caller is a house member ────────────────────────────────────
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { count: memberCount } = await admin
    .from('house_members')
    .select('*', { count: 'exact', head: true })
    .eq('house_id', house_id)
    .eq('user_id', user.id)

  if (!memberCount) return new Response('Forbidden', { status: 403 })

  // ── 4. Compute month boundaries ───────────────────────────────────────────
  const monthStart = month.slice(0, 7) + '-01'
  const monthDate = new Date(monthStart + 'T00:00:00Z')
  const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0))
  const monthEndStr = dateToYMD(monthEnd)
  const today = dateToYMD(new Date())
  const evalEnd = today < monthEndStr ? today : monthEndStr

  // ── 5. Fetch chores active at any point in this month ─────────────────────
  const { data: chores } = await admin
    .from('chores')
    .select('id, due_date, frequency, days_of_week, created_at, archived_at')
    .eq('house_id', house_id)
    .or(`archived_at.is.null,archived_at.gte.${monthStart}`)

  if (!chores) return new Response('Internal Error', { status: 500 })

  // ── 6. Early return if no chores in this month ────────────────────────────
  if (chores.length === 0) {
    const { data: goal } = await admin
      .from('house_monthly_goals')
      .select('reward_text, target_pct')
      .eq('house_id', house_id)
      .eq('month', monthStart)
      .maybeSingle()
    return new Response(JSON.stringify({
      on_time_completions: 0,
      expected_completions: 0,
      momentum_pct: 0,
      reward_text: goal?.reward_text ?? null,
      target_pct: goal?.target_pct ?? 90,
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })
  }

  // ── 7. Build expected occurrences ─────────────────────────────────────────
  let expectedCompletions = 0
  const choreIdSet = new Set(chores.map(c => c.id))

  for (const chore of chores) {
    const choreStart = chore.created_at.slice(0, 10) > monthStart
      ? chore.created_at.slice(0, 10)
      : monthStart
    const days = daysInRange(choreStart, evalEnd)
    for (const day of days) {
      const dow = new Date(day + 'T00:00:00Z').getUTCDay()
      if (isChoreActiveOnDate(chore, day, dow)) expectedCompletions++
    }
  }

  // ── 8. Fetch completions in this month for this house ─────────────────────
  const { data: completions } = await admin
    .from('chore_completions')
    .select('chore_id, for_date')
    .in('chore_id', [...choreIdSet])
    .gte('for_date', monthStart)
    .lte('for_date', evalEnd)

  // ── 9. Count on-time completions ──────────────────────────────────────────
  const choreMap = new Map(chores.map(c => [c.id, c]))
  let onTimeCompletions = 0

  for (const comp of completions ?? []) {
    const chore = choreMap.get(comp.chore_id)
    if (!chore) continue
    const dow = new Date(comp.for_date + 'T00:00:00Z').getUTCDay()
    if (isChoreActiveOnDate(chore, comp.for_date, dow)) {
      onTimeCompletions++
    }
  }

  // ── 10. Fetch goal ────────────────────────────────────────────────────────
  const { data: goal } = await admin
    .from('house_monthly_goals')
    .select('reward_text, target_pct')
    .eq('house_id', house_id)
    .eq('month', monthStart)
    .maybeSingle()

  const momentumPct = expectedCompletions === 0
    ? 0
    : Math.round((onTimeCompletions / expectedCompletions) * 100)

  return new Response(JSON.stringify({
    on_time_completions: onTimeCompletions,
    expected_completions: expectedCompletions,
    momentum_pct: momentumPct,
    reward_text: goal?.reward_text ?? null,
    target_pct: goal?.target_pct ?? 90,
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
```

- [ ] **Deploy function**

```bash
supabase functions deploy get-house-momentum
```

- [ ] **Manual integration test** — call function with a valid JWT and verify response shape

```bash
curl -X POST \
  'https://<project-ref>.supabase.co/functions/v1/get-house-momentum' \
  -H 'Authorization: Bearer <user-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"house_id": "<house-id>", "month": "2026-06-01"}'
```

Expected response:
```json
{
  "on_time_completions": <number>,
  "expected_completions": <number>,
  "momentum_pct": <0-100>,
  "reward_text": null,
  "target_pct": 90
}
```

- [ ] **Test unauthorized access** — call without JWT, expect 401

- [ ] **Test wrong house** — call with JWT of user not in the house, expect 403

- [ ] **Commit**

```bash
git add supabase/functions/get-house-momentum/index.ts
git commit -m "feat(gamification): get-house-momentum Edge Function with JWT + membership auth"
```

---

## Checkpoint 5: Client Types, Hooks, and Tests

**Files:**
- Modify: `types/database.ts`
- Create: `hooks/useTodayPoints.ts`
- Create: `hooks/useStreak.ts`
- Create: `hooks/useHouseMomentum.ts`
- Create: `hooks/useMonthlyGoal.ts`
- Create: `__tests__/hooks/useTodayPoints.test.ts`
- Create: `__tests__/momentum.test.ts`

### Task 5.1 — TypeScript types

- [ ] **Add gamification types to `types/database.ts`**

```ts
export type ScoreLedgerEventType =
  | 'chore_completion'
  | 'chore_completion_reversal'
  | 'streak_bonus'       // reserved, not used in Phase 2

export interface ScoreLedgerEntry {
  id: string
  user_id: string
  house_id: string
  event_type: ScoreLedgerEventType
  points: number
  chore_id: string | null
  for_date: string        // YYYY-MM-DD
  created_at: string
}

export interface UserStreak {
  user_id: string
  current_streak: number
  longest_streak: number
  last_active_date: string | null  // YYYY-MM-DD
  updated_at: string
}

export interface HouseMonthlyGoal {
  id: string
  house_id: string
  month: string           // YYYY-MM-DD, first of month
  reward_text: string
  target_pct: number
  created_at: string
  updated_at: string
}

export interface HouseMomentum {
  on_time_completions: number
  expected_completions: number
  momentum_pct: number
  reward_text: string | null
  target_pct: number
}
```

- [ ] **Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Commit**

```bash
git add types/database.ts
git commit -m "feat(gamification): gamification TypeScript types"
```

---

### Task 5.2 — Hook: `useTodayPoints`

- [ ] **Write the hook**

```ts
// hooks/useTodayPoints.ts
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useTodayPoints(userId: string | undefined) {
  const [todayPoints, setTodayPoints] = useState(0)

  async function fetch() {
    if (!userId) { setTodayPoints(0); return }
    const { data } = await supabase
      .from('score_ledger')
      .select('points')
      .eq('user_id', userId)
      .eq('for_date', todayISO())
    const sum = (data ?? []).reduce((acc, row) => acc + row.points, 0)
    setTodayPoints(Math.max(0, sum))
  }

  useEffect(() => {
    fetch()
    if (!userId) return
    const channel = supabase
      .channel(`score_ledger:${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'score_ledger',
        filter: `user_id=eq.${userId}`,
      }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  return { todayPoints }
}
```

---

### Task 5.3 — Hook: `useStreak`

```ts
// hooks/useStreak.ts
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { UserStreak } from '@/types/database'

export function useStreak(userId: string | undefined) {
  const [streak, setStreak] = useState<UserStreak | null>(null)

  const fetch = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('user_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    setStreak(data)
  }, [userId])

  // useFocusEffect requires a sync callback that optionally returns a cleanup.
  // Passing an async function directly returns a Promise, which React treats as
  // a cleanup function and calls `.then()` on — causing a runtime warning.
  // Wrap in a sync callback and use void to discard the Promise.
  useFocusEffect(
    useCallback(() => {
      void fetch()
    }, [fetch])
  )

  return {
    currentStreak: streak?.current_streak ?? 0,
    longestStreak: streak?.longest_streak ?? 0,
  }
}
```

---

### Task 5.4 — Hook: `useHouseMomentum`

```ts
// hooks/useHouseMomentum.ts
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { HouseMomentum } from '@/types/database'

function currentMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function useHouseMomentum(houseId: string | undefined) {
  const [momentum, setMomentum] = useState<HouseMomentum | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }

    const res = await supabase.functions.invoke('get-house-momentum', {
      body: { house_id: houseId, month: currentMonthISO() },
    })
    if (!res.error && res.data) setMomentum(res.data as HouseMomentum)
    setLoading(false)
  }, [houseId])

  useEffect(() => {
    fetch()
    if (!houseId) return
    // Refetch whenever completions change for this house
    const channel = supabase
      .channel(`momentum:${houseId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chore_completions',
      }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetch])

  return { momentum, loading, refetch: fetch }
}
```

---

### Task 5.5 — Hook: `useMonthlyGoal`

```ts
// hooks/useMonthlyGoal.ts
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { HouseMonthlyGoal } from '@/types/database'

function currentMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function useMonthlyGoal(houseId: string | undefined) {
  const [goal, setGoal] = useState<HouseMonthlyGoal | null>(null)

  const fetch = useCallback(async () => {
    if (!houseId) return
    const { data } = await supabase
      .from('house_monthly_goals')
      .select('*')
      .eq('house_id', houseId)
      .eq('month', currentMonthISO())
      .maybeSingle()
    setGoal(data)
  }, [houseId])

  useEffect(() => {
    fetch()
    if (!houseId) return
    const channel = supabase
      .channel(`monthly_goal:${houseId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'house_monthly_goals',
        filter: `house_id=eq.${houseId}`,
      }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetch])

  async function setGoalText(rewardText: string, targetPct = 90): Promise<{ error: string | null }> {
    if (!houseId) return { error: 'no house' }
    const { error } = await supabase
      .from('house_monthly_goals')
      .upsert({
        house_id: houseId,
        month: currentMonthISO(),
        reward_text: rewardText,
        target_pct: targetPct,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'house_id,month' })
    if (!error) await fetch()
    return { error: error?.message ?? null }
  }

  return { goal, setGoal: setGoalText }
}
```

- [ ] **Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Run full test suite**

```bash
npx jest --no-coverage
```

- [ ] **Commit all hooks**

```bash
git add hooks/useTodayPoints.ts hooks/useStreak.ts hooks/useHouseMomentum.ts hooks/useMonthlyGoal.ts
git commit -m "feat(gamification): useTodayPoints, useStreak, useHouseMomentum, useMonthlyGoal hooks"
```

---

## Tricky Test Cases — Must Verify Before Phase 2b

These are the three areas most likely to have bugs. Verify manually in the Supabase SQL Editor and via the app before calling Phase 2a done.

### A — Archived chore does not corrupt momentum

1. Create a daily chore on June 1.
2. Mark it done June 1–5 (5 completions).
3. Archive it on June 6 (set `archived_at = '2026-06-06T00:00:00Z'`).
4. Call `get-house-momentum` for June.
5. Expected: `expected_completions` = 5 (June 1–5 only), `on_time_completions` = 5. Momentum = 100%.
6. Expected: June 6 onward does NOT appear in expected — no denominator penalty for archiving.

### B — Undo scoring reversal is correct

1. Mark a chore done → verify `score_ledger` has `+10`.
2. Undo → verify `score_ledger` has a subsequent `-10` row.
3. `todayPoints` should return 0 (net 0).
4. Mark done again → verify a new `+10` is created (not a duplicate rejection).

### C — Recurring chore momentum is zero before first active day

1. Create a weekly chore (Mondays only) on a Wednesday.
2. Call `get-house-momentum` the same Wednesday.
3. Expected: `expected_completions = 0` (no Monday has passed yet this week after creation), `momentum_pct = 0`.
4. On the following Monday, mark it done.
5. Expected: `expected_completions = 1`, `on_time_completions = 1`, `momentum_pct = 100`.

---

## Notes on Smaller Concerns

**Realtime subscription in `useHouseMomentum` is unscoped.**
The subscription listens to all `chore_completions` changes without a house filter. Postgres realtime channel filters on junction tables are awkward; the current approach is acceptable for MVP (small houses, low event volume). In Phase 3, scope using a custom realtime topic or filter by `chore_id in (...)` if performance becomes a concern.

**`supabase db push` targets the linked remote.**
This is the hosted Supabase project, not a local database. If you are running `supabase start` locally, use `supabase db reset` to replay migrations against the local stack instead. Confirm with `supabase status` before every push.

**Checkpoints are sequentially dependent, not independent.**
Checkpoint 2 requires the `chores.archived_at` column from Checkpoint 1. Checkpoint 3 requires `score_ledger` from Checkpoint 2 (for the streak function to have access to the full schema). Do not skip ahead.

---

## Phase 2a Done Criteria

- [ ] Worktree clean before starting — no unrelated modified files in gamification commits
- [ ] All 4 migrations applied (`archived_at`, `score_ledger`, `user_streaks`, `house_monthly_goals`)
- [ ] `npx tsc --noEmit` passes
- [ ] `npx jest --no-coverage` passes
- [ ] Tricky test cases A, B, and C manually verified
- [ ] `get-house-momentum` returns 401 without JWT, 403 for non-member
- [ ] `evaluate-streaks` cron registered at `0 10 * * *`
- [ ] `evaluate-streaks` processes all house members, not just push_token holders
- [ ] No `AFTER DELETE` trigger exists on `chore_completions`
- [ ] `deleteChore` in the app now archives instead of hard-deletes
- [ ] RLS policy `no completions on archived chores` exists on `chore_completions`
- [ ] Trigger `award_completion_points` skips archived chores (belt-and-suspenders)
- [ ] Archived chore: verify completion insert is blocked by RLS
- [ ] Archived chore: verify notification does not fire after `archived_at` date
- [ ] Both security definer functions have `set search_path = public`
- [ ] `uuid_generate_v4()` used in all new migrations (not `gen_random_uuid()`)

Phase 2b (UI) does not begin until all criteria above are checked.
