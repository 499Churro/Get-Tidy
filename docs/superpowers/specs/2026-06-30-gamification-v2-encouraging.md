# Gamification v2 — Encouraging, No Leaderboard

**Status:** Approved for build  
**Supersedes:** `2026-06-30-gamification-architecture.md` (contained roommate leaderboard and `house_scores` ranking table — both removed)  
**Revised:** 2026-06-30 — six blocking flags resolved; four additional flags resolved (see bottom of doc)

---

## Product Principles

| Principle | Implication |
|-----------|-------------|
| No roommate-vs-roommate ranking | No `house_scores` table. No rank numbers. No per-person public score display. |
| No "who failed" messaging | Copy never names who missed a chore. |
| Streaks are personal encouragement | `user_streaks` is private to the individual. Not shown to other members. No bonus points for milestones — display only. |
| Points are personal contribution history | `score_ledger` is a personal audit trail. "Today's contribution" only. Not a public scoreboard. |
| House momentum is collaborative | One shared progress meter for the whole house. Wins and misses belong to everyone together. |

---

## User-Facing Experience

### Home Tab — Personal Rhythm

The home tab shows the current user's personal contribution only. No comparison to roommates.

| Element | Value | Notes |
|---------|-------|-------|
| Streak display | "4 days steady" | Text label. No milestone bonus points — streaks are display-only encouragement in Phase 2. |
| Today's points | "+20 today" | Sum of `score_ledger.points` for `for_date = today`, this user. |
| Completion animation | `+10` or `+15` floating pill | Fades out after ~1.2s. No confetti. |
| Miss copy | None | No shame copy for missed chores. Neutral empty state. |
| Roommate comparison | None | Not shown anywhere on Home. |

### House Tab — Monthly Momentum Goal

A single shared meter shows how the whole house is tracking toward a self-set monthly goal.

| Element | Value | Notes |
|---------|-------|-------|
| Empty state (no goal set) | "Set a house goal" prompt | Meter is hidden until `reward_text` exists. Show a single CTA to set one. |
| Progress meter | "74% toward Movie Night" | Shown only after a goal is set. |
| Goal label | Custom reward text | "Movie night," "Dinner out," etc. Free text. Any member can set it. |
| Missed chores | Lower percentage, no callout | Percentage drops but no person is named. |
| Month reset | Never mid-month | Runs from the 1st to the last day of the calendar month. |
| Preset suggestions | None | Free text only in Phase 2 MVP. |

**Inline recap copy** (below the meter, derived from live momentum data — no separate Edge Function):
- "Your house completed 82% of chores on time this week."
- "Movie night is still in reach."
- "You kept things moving 5 days this week." (personal, not comparative)

---

## Decisions — Resolved

### 1. What counts as "on time" for recurring chores?

A completion is **on time** if `for_date` is a day when `is_chore_active(chore, for_date)` returns `true`.

Rationale: recurring chores have no single `due_date`. They are active on specific days. A completion on an active day is on time. A completion on a non-active day is anomalous (the app does not normally allow it). The `is_chore_active` function is already the authoritative source of which days a chore is expected.

This removes the `for_date <= due_date` condition entirely. `due_date` is only relevant for one-time chores. For one-time chores, on time = `for_date <= due_date`.

| Frequency | On-time definition |
|-----------|-------------------|
| `daily` | Completed on the active day |
| `weekly` | Completed on any active `days_of_week` day in the week |
| `biweekly` | Completed on the active occurrence day |
| `monthly` | Completed on the active occurrence day |
| One-time (`due_date`) | `for_date <= due_date` |

### 2. Soft-delete for chores — added to Phase 2

Add `archived_at timestamptz` column to `chores`. Archived chores:
- No longer appear in the app UI (filtered by `archived_at is null` in all client-facing queries).
- Their past `chore_completions` rows are **preserved** (not cascaded).
- Their completed occurrences continue to count in the momentum numerator for months they were completed in.
- Their future expected occurrences stop contributing to the denominator from the archive date onward.

This prevents the momentum meter from dropping when someone deletes a previously-completed chore. "Delete" in the UI becomes "archive" in the DB. True hard-delete is removed from the client in Phase 2.

**`is_chore_active` gets date-aware archive logic:**

```ts
// is_chore_active must NOT simply return false when archived_at is set.
// It must return false only for evaluation dates on or after the archive date.
if (chore.archived_at) {
  const archivedDate = chore.archived_at.slice(0, 10)
  if (evaluationDate >= archivedDate) return false
  // evaluationDate is before archive — evaluate normally
}
```

This means a chore archived on June 20 still counts as active (and its completions count) for June 1–19. Expected occurrences for June 1–19 still appear in the denominator. Only June 20 onward is excluded.

**The momentum Edge Function fetches both active and recently-archived chores:**

The fetch query is **not** `where archived_at is null`. That would exclude archived chores entirely, dropping their past completions from the numerator and silently distorting momentum.

Instead, the Edge Function fetches:
```ts
// Fetch chores that were active at any point during the requested month
const chores = await supabase
  .from('chores')
  .select('*')
  .eq('house_id', house_id)
  .or(`archived_at.is.null,archived_at.gte.${month_start}`)
```

This returns: (a) all currently active chores, plus (b) chores archived on or after the first of the requested month. Chores archived before the month started are excluded — they could not have had occurrences in this month.

### 3. Momentum empty state

Until `house_monthly_goals` has a row for the current month, show a prompt:

> **"Set a house goal for this month"**  
> Any member can set a shared reward like "Movie night" or "Dinner out."

The momentum meter is hidden until a goal is set. Once set, the meter appears and starts from the current on-time percentage for the month so far (retroactive to month start).

### 4. Streak milestones — bonus points removed from Phase 2

Streak milestone bonuses (+50 at 7 days, +200 at 30 days) are **removed from Phase 2**. Rationale: without a leaderboard or public score display, a sudden "+50 today" is confusing and feels arbitrary. Streaks are display-only in Phase 2 — a personal label, not a points multiplier.

The `evaluate-streaks` Edge Function tracks `current_streak` and `longest_streak` in `user_streaks`. It does **not** insert milestone rows into `score_ledger`. The `event_type = 'streak_bonus'` enum value is reserved for Phase 3 (when a proper celebration UI can make it legible).

### 5. Momentum calculation location — Edge Function, not Postgres RPC

The `get_house_momentum` calculation lives in a Supabase Edge Function, not a Postgres RPC.

Reason: the expected-occurrences count requires applying `is_chore_active` logic, which already exists as `supabase/functions/_shared/is-chore-active.ts`. Duplicating this logic in PL/pgSQL would create two sources of truth for recurrence rules — a maintenance and correctness risk.

The Edge Function `get-house-momentum` is called by `useHouseMomentum` on the client. It accepts `{ house_id, month }` and returns:

```json
{
  "on_time_completions": 74,
  "expected_completions": 100,
  "momentum_pct": 74,
  "reward_text": "Movie night",
  "target_pct": 90
}
```

The client hook caches this and subscribes to `chore_completions` inserts/deletes to trigger a refetch. The Edge Function result is not stored — it is recomputed on demand.

### 6. `house-recap` Edge Function — removed from Phase 2

The weekly/monthly summary copy on the House tab is computed **inline** from the same momentum data already fetched by `useHouseMomentum`. No separate Edge Function, no recap log table, no scheduling needed.

Examples of inline recap copy (generated client-side from live data):
- `momentum_pct >= target_pct` → "Movie night is still on track. Keep it up."
- `momentum_pct >= 70` → "Your house completed {pct}% of chores on time this month."
- `momentum_pct < 70` → "Movie night is still in reach — a strong finish gets you there."

Push notification recap delivery is Phase 3.

---

## Data Model

### `score_ledger` — keep, personal contribution history

Append-only. Writable by triggers and RPCs only. No client writes.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → profiles ON DELETE CASCADE |
| `house_id` | `uuid` | FK → houses ON DELETE CASCADE |
| `event_type` | `text` | `chore_completion` \| `chore_completion_reversal` |
| `points` | `integer` | signed — `+10` normal, `+15` overdue, `-10`/`-15` reversal |
| `chore_id` | `uuid` | nullable, FK → chores ON DELETE SET NULL |
| `for_date` | `date` | logical date of the occurrence |
| `created_at` | `timestamptz` | default now() |

Note: `streak_bonus` event_type is reserved but not used in Phase 2.

### `user_streaks` — keep, personal streak state

Written by `evaluate-streaks` Edge Function only. Not readable by other house members.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `uuid` | PK, FK → profiles ON DELETE CASCADE |
| `current_streak` | `integer` | current consecutive-day count |
| `longest_streak` | `integer` | all-time best |
| `last_active_date` | `date` | last date all assigned chores were completed |
| `updated_at` | `timestamptz` | |

### `house_monthly_goals` — new, collaborative goal setting

One row per house per month. Client-writable by house members.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `house_id` | `uuid` | FK → houses ON DELETE CASCADE |
| `month` | `date` | First day of the month: `2026-06-01`. Unique per house per month. |
| `reward_text` | `text` | e.g. "Movie night" — free text, no presets |
| `target_pct` | `integer` | Default 90. Range 1–100. |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Unique constraint: `(house_id, month)`. Last-write-wins on concurrent edits (acceptable for Phase 2).

### `chores` table — add `archived_at` column

```sql
alter table public.chores
  add column archived_at timestamptz default null;
```

All chore queries gain `where archived_at is null`. The `is_chore_active` function gains an `archived_at` guard. The client "delete" action sets `archived_at = now()` instead of issuing a hard delete. Past completions are preserved. Hard-delete is removed from the client in Phase 2.

### Removed from v1

`house_scores` — removed. Leaderboard table. Not needed without ranking.

---

## Scoring Flow

### Completion

1. Client inserts into `chore_completions` (existing behavior).
2. Postgres `AFTER INSERT` trigger fires.
3. Trigger computes points:
   - Chore has `due_date` set **and** `for_date > due_date` → **+15** (overdue one-time chore)
   - All other cases → **+10**
4. Trigger inserts one row into `score_ledger` (`event_type = 'chore_completion'`).

**Phase 2 rule: overdue bonus only applies to one-time chores.**

Recurring chores (`daily`, `weekly`, `biweekly`, `monthly`) always score `+10`, even if completed late relative to their expected day. This is intentional: recurring chores have no single canonical `due_date`, so no trigger-level overdue signal exists. A recurring chore completed a day late still gets `+10`.

The `+15` bonus is exclusively for one-time chores (where `chore.due_date IS NOT NULL`). This is the same signal already used by the UI to show the "Overdue" badge.

Per-occurrence expected dates for recurring chores (needed for a recurring overdue bonus) are a Phase 3 addition. The doc must not imply recurring overdue scoring is implemented — it is not.

### Undo path (via RPC, not direct delete)

1. Client calls `supabase.rpc('undo_chore_completion', { chore_id, for_date })`.
2. RPC (`SECURITY DEFINER`) verifies the completion belongs to `auth.uid()`.
3. RPC deletes the `chore_completions` row.
4. RPC inserts a reversal row into `score_ledger` (`event_type = 'chore_completion_reversal'`, signed negative).
5. `useHouseMomentum` refetches from `get-house-momentum` Edge Function (subscription fires on completion delete).

No `AFTER DELETE` trigger on `chore_completions`. Cascade-safe.

---

## Streak Flow

`evaluate-streaks` Edge Function — runs daily at **10:00 UTC**.

Rationale: US timezones span UTC-10 (Hawaii) to UTC-4 (Eastern summer). Local midnight for Hawaii = 10:00 UTC. Running at 10:00 UTC ensures every US user's local day has fully ended before "local yesterday" is evaluated. 02:00 UTC is too early — it evaluates Pacific users while their day is still in progress.

If the app expands to international users, this should switch to an hourly cron that processes each user only once their local midnight has passed (`now() AT TIME ZONE profile.timezone >= midnight + 2h` as a buffer). For Phase 2 (US-only), 10:00 UTC is sufficient.

For each user with an active push token:

1. Resolve local yesterday using `profiles.timezone`.
2. Query chores assigned to this user that were active on local yesterday (using `is_chore_active`, respecting `archived_at`).
3. **No assigned active chores yesterday** → neutral day. No streak change.
4. **All assigned chores completed** →
   - If `last_active_date = yesterday - 1` → `current_streak += 1`
   - Otherwise → `current_streak = 1`
   - Update `longest_streak` if exceeded.
   - Set `last_active_date = yesterday`.
5. **Incomplete** → `current_streak = 0`.

No milestone bonus points in Phase 2. Streaks are display-only.

Unassigned chores (`assigned_to = null`) are excluded from personal streak evaluation. They affect house momentum but not individual streaks.

---

## Momentum Flow

`get-house-momentum` Edge Function — called on demand by `useHouseMomentum`.

Input: `{ house_id, month }`

Algorithm:
1. Fetch all chores for `house_id` that were active at any point during the requested month: `archived_at is null OR archived_at >= month_start`. Chores archived before the month started are excluded — they had no occurrences in this month.
2. For each day `d` from `max(month_start, chore.created_at::date)` to `min(today, month_end)`:
   - If `is_chore_active(chore, d)` → increment `expected_completions`.
3. Fetch all `chore_completions` for the house where `for_date` falls in the month.
4. For each completion: if `is_chore_active(chore, completion.for_date)` → on-time → increment `on_time_completions`.
   - For one-time chores: also check `for_date <= chore.due_date`.
5. Fetch `house_monthly_goals` for `(house_id, month)` → get `reward_text`, `target_pct`.
6. Return the payload.

Archived chores: their past completions in the current month still count in the numerator (completions are preserved). Their future expected occurrences stop at `archived_at::date`.

---

## Client Hooks

| Hook | Source | Returns | Used on |
|------|--------|---------|---------|
| `useTodayPoints(userId)` | `score_ledger` real-time sub | `{ todayPoints: number }` | Home tab |
| `useStreak(userId)` | `user_streaks`, refresh on focus | `{ currentStreak, longestStreak }` | Home tab |
| `useHouseMomentum(houseId)` | `get-house-momentum` Edge Function, refetch on completion events | `{ onTimeCompletions, expectedCompletions, momentumPct, rewardText, targetPct }` | House tab |
| `useMonthlyGoal(houseId)` | `house_monthly_goals` real-time sub | `{ goal, setGoal }` | House tab |

`useMyScore` and `useLeaderboard` from v1 are removed.

---

## UI Integration Points

### Home tab (`app/(app)/index.tsx`)

- Below avatar: streak label `"N days steady"` (hidden if `currentStreak === 0`).
- Next to avatar or below: `"+N today"` (hidden if `todayPoints === 0`).
- On chore completion: floating `+10` or `+15` pill animates up and fades out.

### House tab (`app/(app)/house.tsx`)

- If no goal set: "Set a house goal for this month" prompt + input to enter reward text.
- If goal set: progress meter `74% toward Movie Night` + inline recap copy.
- Edit goal: tapping the reward text opens an edit input. Any member can edit.

---

## Security / RLS

| Table | Client SELECT | Client INSERT/UPDATE | Client DELETE |
|-------|---------------|----------------------|---------------|
| `score_ledger` | House members only | None | None |
| `user_streaks` | Own row only (`user_id = auth.uid()`) | None | None |
| `house_monthly_goals` | House members only | House members (own house) | None |

All score writes go through triggers, RPCs, and Edge Functions only.

`house_monthly_goals` RLS write policy:
```sql
with check (house_id in (
  select house_id from public.house_members where user_id = auth.uid()
))
```

---

## Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `evaluate-streaks` | pg_cron: daily 10:00 UTC | Update `user_streaks` for all active users |
| `get-house-momentum` | On demand (called by `useHouseMomentum`) | Compute on-time % for a house-month using `is_chore_active` |

`house-recap` Edge Function is **not in Phase 2**. Recap copy is computed inline on the client from live momentum data.

### `get-house-momentum` security contract

This function is called by the client with the user's JWT. It uses the service role key internally to read across tables. Because it bypasses RLS internally, it **must** verify caller authorization explicitly before returning any data:

```ts
// 1. Verify JWT — Supabase automatically rejects missing/invalid tokens
const { data: { user }, error } = await supabase.auth.getUser(jwt)
if (error || !user) return 401

// 2. Verify caller is a member of the requested house_id
const { count } = await adminClient
  .from('house_members')
  .select('*', { count: 'exact', head: true })
  .eq('house_id', house_id)
  .eq('user_id', user.id)
if (count === 0) return 403

// 3. Only then proceed with the service-role computation
```

The response contains only data for the requested `house_id`. No cross-house data is ever returned.

---

## Implementation Phases

### Phase 2a — Foundation

| # | Task |
|---|------|
| 1 | Migration: add `archived_at` to `chores`; update all chore queries with `where archived_at is null` |
| 2 | Migration: create `score_ledger` with RLS |
| 3 | Migration: create `user_streaks` with RLS |
| 4 | Migration: create `house_monthly_goals` with RLS |
| 5 | Migration: `award_completion_points` AFTER INSERT trigger on `chore_completions` |
| 6 | Migration: `undo_chore_completion` RPC (SECURITY DEFINER) |
| 7 | Update `hooks/useChores.ts`: `undoMarkDone` calls RPC; `deleteChore` sets `archived_at` instead of hard-deleting |
| 8 | Edge Function: `evaluate-streaks` |
| 9 | Edge Function: `get-house-momentum` (using `_shared/is-chore-active.ts`) |
| 10 | TypeScript types: `ScoreLedgerEntry`, `UserStreak`, `HouseMonthlyGoal`, `HouseMomentum` |
| 11 | Hooks: `useTodayPoints`, `useStreak`, `useHouseMomentum`, `useMonthlyGoal` |

No UI changes in Phase 2a. Stable data + hook layer ships first.

### Phase 2b — UI

| # | Task |
|---|------|
| 12 | Home tab: streak label "N days steady" |
| 13 | Home tab: "+N today" points display |
| 14 | Home tab: +10/+15 floating pill animation on completion |
| 15 | House tab: "Set a house goal" empty state prompt |
| 16 | House tab: monthly momentum meter with reward text and inline recap copy |
| 17 | House tab: edit monthly goal UI |

---

## Explicitly Out of Scope — Phase 2

- Global ranking or leaderboard of any kind
- Roommate-vs-roommate score comparison
- Public per-person score display visible to other members
- Streak milestone bonus points (display-only in Phase 2; bonus points deferred to Phase 3)
- Achievement badges
- Preset reward suggestions
- Push notifications for recap
- `house-recap` Edge Function
- Weekly recap Edge Function
- Materialized view for momentum
- Points history screen
- True hard-delete of chores (replaced by archive)

---

## Resolved Flags

| Flag | Decision |
|------|----------|
| "On time" undefined for recurring chores | On time = `is_chore_active(chore, for_date)` returns true. No `due_date` dependency for recurring chores. |
| Chore deletion corrupts momentum | Soft-delete added to Phase 2. `archived_at` column on `chores`; past completions preserved on archive. |
| Momentum empty state | Show "Set a house goal" prompt. Meter hidden until `reward_text` exists. |
| Streak bonus points confusing without leaderboard | Bonus points removed from Phase 2. Streaks are display-only encouragement. |
| RPC vs Edge Function inconsistency | Edge Function (`get-house-momentum`) is the source of truth. Reuses `_shared/is-chore-active.ts`. No PL/pgSQL duplication. |
| `house-recap` Edge Function is overbuild | Removed from Phase 2. Inline recap copy computed client-side from live momentum data. |
| Archived chore fetch excludes past completions | Momentum Edge Function fetches `archived_at is null OR archived_at >= month_start`. `is_chore_active` is date-aware: returns false only for `evaluationDate >= archivedDate`. Momentum Flow Step 1 matches — no stale `archived_at is null` wording remains. |
| Streak cron fires too early (02:00 UTC) | Changed to 10:00 UTC — after local midnight for all US timezones including Hawaii (UTC-10). Hourly cron flagged as Phase 3 path for international users. |
| `get-house-momentum` security unspecified | Explicit JWT verification + house membership check before any service-role data access. Returns 401/403 on failure. Response scoped to requested `house_id` only. |
| Overdue +15 vague for recurring chores | Overdue bonus is one-time chores only (`due_date IS NOT NULL`). Recurring chores always score +10. Per-occurrence overdue for recurring chores is Phase 3. |
