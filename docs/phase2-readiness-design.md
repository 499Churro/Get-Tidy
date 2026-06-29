# Phase 2 Readiness — Design Document

**Goal:** Close the remaining pre-gamification issues, establish a clean baseline, and lay the schema + architecture foundation for Phase 2 (streaks, scores, leaderboard) without implementing Phase 2 UI yet.

No changes until this document is approved.

---

## Part A — Pre-Gamification Cleanup

These are blocking or near-blocking issues found in the Codex scan + internal audit. All must be resolved before building Phase 2.

---

### A1 — `@types/jest` version mismatch (High — build tooling)

**File:** `package.json`

**Problem:** `"@types/jest": "^30.0.0"` is installed, but Expo SDK 56 expects `29.5.14`. `expo-doctor` and `npx expo install --check` both fail. The `^` range means npm can resolve to 30.x, which may have breaking type changes.

**Fix:** Pin to the version Expo SDK 56 expects:
```json
"@types/jest": "29.5.14"
```

Run `npx expo install --check` to confirm no remaining version conflicts.

---

### A2 — Web build broken (Medium — scope decision)

**File:** `package.json` (`web` script), `app.json` (web config)

**Problem:** `npx expo export --platform web` fails because `react-dom` and `react-native-web` are missing. The Phase 1 spec listed "iOS (primary), Web (accessible)" but web was never fully wired up. A broken `web` script in CI or `expo doctor` creates noise.

**Decision required (two options):**

- **Option A — Mobile-only (recommended for Phase 2):** Remove the `web` script from `package.json` and the `web` block from `app.json`. Web support can be added properly in a dedicated pass when needed. This keeps the scope clean.
- **Option B — Fix web support:** Run `npx expo install react-dom react-native-web`. Then audit every screen for web-incompatible RN components (notably `@gorhom/bottom-sheet` is mobile-only).

**Recommendation: Option A.** Phase 2 gamification is mobile-first. Unblock web properly when the product needs it.

---

### A3 — Untracked files + live migration (High — deployment)

**Files:** `lib/pendingInvite.ts`, `docs/audit-fixes-design.md`, `docs/qa-followup-design.md`, `supabase/migrations/20260625000001_tighten_completion_rls.sql`

**Problem:** Four files are untracked in git. The migration is the critical one: `tighten_completion_rls.sql` closes the cross-house completion insert gap, but it has **zero effect** until pushed to the live Supabase project.

**Fix:**
1. `git add` all four untracked files and commit.
2. Run `supabase db push` to apply `20260625000001_tighten_completion_rls.sql` to the live project.
3. Verify via Supabase dashboard that the new policy `completions: insert own` has the house-membership check.

---

### A4 — `deleteChore` silently drops completion delete error (Medium — correctness)

**File:** `hooks/useChores.ts:177`

**Problem:**
```ts
await supabase.from('chore_completions').delete().eq('chore_id', choreId)  // error ignored
const { error } = await supabase.from('chores').delete().eq('id', choreId)
```
If the completion delete fails (RLS, network error), the chore delete still proceeds. In practice the `chore_completions` table has `ON DELETE CASCADE` from `chores`, so the DB cleans up completions automatically when the chore is deleted. The client-side pre-delete is redundant and can be removed entirely — the cascade handles it.

**Fix:** Remove the client-side completion pre-delete. Let the DB cascade handle it:
```ts
async function deleteChore(choreId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('chores').delete().eq('id', choreId)
  if (!error) await fetchAll()
  return { error: error?.message ?? null }
}
```

---

### A5 — `registerForPushNotifications` ignores Supabase error (Low — observability)

**File:** `lib/notifications.ts:37`

**Problem:**
```ts
await supabase.from('profiles').update({ push_token: token }).eq('id', userId)
```
The result is not captured. If the write fails, `push_token` is never saved. Notifications silently stop working with no trace.

**Fix:** Capture and log the error. No Alert (this runs in background); just return `null` on failure so the caller knows registration didn't complete:
```ts
const { error } = await supabase.from('profiles').update({ push_token: token }).eq('id', userId)
if (error) return null
return token
```

---

### A6 — `AddChoreSheet` stale `resetForm` in `useEffect` (Medium — correctness)

**File:** `components/chores/AddChoreSheet.tsx:90`

**Problem:**
```ts
useEffect(() => {
  // ...
  resetForm()
}, [editingChore])  // resetForm missing from deps
```
`resetForm` is a `useCallback` that closes over `currentUserId`. If `currentUserId` changes (user profile update mid-session), the effect holds a stale closure and resets the form with the wrong `assignedTo` default.

**Fix:** Add `resetForm` to the dependency array:
```ts
}, [editingChore, resetForm])
```

---

### A7 — Watchman recrawl warning (Low — local dev only)

Not a build issue. Clear it locally when convenient:
```bash
watchman watch-del '/Users/alexjjchen/chore-app'
watchman watch-project '/Users/alexjjchen/chore-app'
```

---

## Part B — Gamification Foundation (Schema + Architecture)

Phase 2 per the PRD: **Streaks, scores, leaderboards.** This section designs the data layer and architecture contracts. No UI is built in this pass — the goal is to add the schema and server-side logic so Phase 2 UI can be built on top of a stable foundation.

---

### B1 — What gamification needs from the data layer

| Feature | What it requires |
|---------|-----------------|
| Streak | Per-user count of consecutive days where all assigned chores were completed. Needs daily evaluation. |
| Score | A point total per user, accumulated on each completion. Needs an append-only ledger to support history, not just a counter. |
| Leaderboard | A per-house ranking of members by score or streak. Needs a fast read path — computed on query or pre-aggregated. |
| Completion celebration | Client-side animation only. No schema change. |

---

### B2 — New schema

Three additions. All are additive migrations — no existing tables are altered.

**`user_streaks`** — denormalized current and best streak per user. Maintained by a scheduled Edge Function (see B3). Readable directly for display.

```sql
create table public.user_streaks (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  current_streak  integer not null default 0,
  longest_streak  integer not null default 0,
  last_active_date date,   -- the most recent date a streak day was credited
  updated_at      timestamptz not null default now()
);
```

**`score_ledger`** — append-only event log. One row per point-earning event. Gives a complete audit trail and lets the UI show "you earned X points for Y" notifications in Phase 3.

```sql
create table public.score_ledger (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  house_id     uuid not null references public.houses(id) on delete cascade,
  event_type   text not null,         -- 'chore_completion' | 'streak_bonus' | etc.
  points       integer not null,
  chore_id     uuid references public.chores(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.score_ledger(user_id, house_id);
create index on public.score_ledger(created_at);
```

**`house_scores`** — pre-aggregated score per user per house. Maintained by a trigger on `score_ledger` (increment on insert). Fast leaderboard read without summing the ledger.

```sql
create table public.house_scores (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  score    integer not null default 0,
  primary key (user_id, house_id)
);
create index on public.house_scores(house_id, score desc);  -- leaderboard query index
```

**Trigger to maintain `house_scores`:**
```sql
create or replace function public.increment_house_score()
returns trigger language plpgsql as $$
begin
  insert into public.house_scores (user_id, house_id, score)
  values (NEW.user_id, NEW.house_id, NEW.points)
  on conflict (user_id, house_id) do update
    set score = house_scores.score + NEW.points;
  return NEW;
end;
$$;

create trigger trg_score_ledger_insert
  after insert on public.score_ledger
  for each row execute function public.increment_house_score();
```

**RLS for new tables:**
```sql
-- user_streaks: user reads own; house members read all in their house
alter table public.user_streaks enable row level security;
create policy "streaks: read own house"
  on public.user_streaks for select
  using (user_id in (
    select user_id from public.house_members where house_id = public.my_house_id()
  ));

-- score_ledger: read own house ledger
alter table public.score_ledger enable row level security;
create policy "score_ledger: read own house"
  on public.score_ledger for select
  using (house_id = public.my_house_id());

-- house_scores: leaderboard — read all scores in own house
alter table public.house_scores enable row level security;
create policy "house_scores: read own house"
  on public.house_scores for select
  using (house_id = public.my_house_id());
```

All writes to `score_ledger`, `house_scores`, and `user_streaks` happen server-side only (Edge Functions + triggers). No client insert/update policies needed.

---

### B3 — Score awarding: when and how much

Points are awarded server-side on each `chore_completions` insert, via a Postgres trigger (not a client call — the client never touches `score_ledger` directly).

**Point values (starting values, tunable):**

| Event | Points |
|-------|--------|
| Complete any chore | +10 |
| Complete an overdue chore | +15 (the extra 5 acknowledges catching up) |
| Streak bonus (7-day) | +50 one-time |
| Streak bonus (30-day) | +200 one-time |

**Trigger on `chore_completions`:**
```sql
create or replace function public.award_completion_points()
returns trigger language plpgsql security definer as $$
declare
  v_house_id uuid;
  v_due_date date;
  v_points integer := 10;
begin
  select house_id, due_date into v_house_id, v_due_date
  from public.chores where id = NEW.chore_id;

  -- Overdue bonus: for_date is after due_date
  if v_due_date is not null and NEW.for_date > v_due_date then
    v_points := 15;
  end if;

  insert into public.score_ledger (user_id, house_id, event_type, points, chore_id)
  values (NEW.completed_by, v_house_id, 'chore_completion', v_points, NEW.chore_id);

  return NEW;
end;
$$;

create trigger trg_completion_award_points
  after insert on public.chore_completions
  for each row execute function public.award_completion_points();
```

---

### B4 — Streak evaluation: scheduled Edge Function

Streaks cannot be computed by a single trigger because "a streak day" requires knowing whether all chores assigned to a user were completed for a given day — not just one completion. A scheduled Edge Function evaluates this daily at midnight UTC.

**Logic (pseudocode):**
```
for each active profile with push_token or recent activity:
  localYesterday = yesterday in user's timezone
  assignedChores = chores assigned to this user active on localYesterday
  if assignedChores.length == 0: skip (no obligation)
  completedYesterday = completions for those chores with for_date = localYesterday
  if all assigned chores were completed:
    if user_streaks.last_active_date == day before localYesterday:
      increment current_streak by 1
    else:
      set current_streak = 1  (streak starts fresh)
    update longest_streak if current_streak > longest_streak
    set last_active_date = localYesterday
    check and award streak milestone bonuses (7-day, 30-day)
  else:
    set current_streak = 0  (streak broken)
```

This runs as `supabase/functions/evaluate-streaks/index.ts`, scheduled alongside the existing notification functions.

**Shared helper:** `_shared/is-chore-active.ts` is already in place and can be reused for the "was this chore active yesterday?" check.

---

### B5 — Client architecture additions

No new screens or tabs in this pass. The foundation only — Phase 2 UI builds on top of this.

**New hook: `useLeaderboard(houseId)`**
```ts
// hooks/useLeaderboard.ts
// Returns house_scores joined with profiles, sorted by score desc.
// Real-time subscription on house_scores for live rank updates.
```

**New hook: `useStreak(userId)`**
```ts
// hooks/useStreak.ts
// Returns user_streaks row for the given user.
// No real-time subscription needed — updated once per day.
```

Both hooks follow the existing `useHouse` / `useChores` pattern (Supabase select + local state). No new state management library needed.

**TypeScript types to add to `types/database.ts`:**
```ts
export interface UserStreak {
  user_id: string
  current_streak: number
  longest_streak: number
  last_active_date: string | null
  updated_at: string
}

export interface ScoreLedgerEntry {
  id: string
  user_id: string
  house_id: string
  event_type: string
  points: number
  chore_id: string | null
  created_at: string
}

export interface HouseScore {
  user_id: string
  house_id: string
  score: number
}
```

---

## Implementation Order

### Part A — Do first (one commit per fix)

| # | Fix | File(s) | Risk |
|---|-----|---------|------|
| A1 | Pin `@types/jest` to `29.5.14` | `package.json` | None |
| A2 | Remove web script + config | `package.json`, `app.json` | None (mobile-only) |
| A3 | Commit untracked files + `supabase db push` | 4 files + CLI | Deployment |
| A4 | Remove redundant completion pre-delete in `deleteChore` | `hooks/useChores.ts` | Low |
| A5 | Capture push token save error | `lib/notifications.ts` | Low |
| A6 | Add `resetForm` to useEffect dep array | `components/chores/AddChoreSheet.tsx` | Low |

### Part B — After Part A is merged + deployed

| # | What | Deliverable |
|---|------|-------------|
| B1 | New migration: `user_streaks`, `score_ledger`, `house_scores`, RLS, trigger | `supabase/migrations/20260629000001_gamification_schema.sql` |
| B2 | Score award trigger in same migration | Included in B1 |
| B3 | `evaluate-streaks` Edge Function | `supabase/functions/evaluate-streaks/index.ts` |
| B4 | Type additions | `types/database.ts` |
| B5 | `useLeaderboard` + `useStreak` hooks | `hooks/useLeaderboard.ts`, `hooks/useStreak.ts` |

Part B produces no visible UI. It is the stable data + hook layer that Phase 2 UI screens plug into.

---

## Open Questions (resolve before Part B implementation)

1. **Streak definition:** Does a day with zero assigned chores count as a "maintained" streak day or a neutral day? The design above skips it (neutral). If the product intent is stricter, the logic changes.
2. **Score reset:** Do scores ever reset (weekly, monthly, per season)? The ledger design supports time-windowed queries but the current `house_scores` is cumulative all-time.
3. **Retroactive streaks:** Does the streak evaluator backfill for days before the feature ships? Recommendation: no — start fresh from deploy date.
4. **Leaderboard scope:** Per-house only, or global? Architecture above is per-house only (matches the product's "roommate group" mental model).
