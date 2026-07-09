> **SUPERSEDED** — This architecture spec references `score_ledger`, `house_scores`, and leaderboard tables that were not built. Current architecture uses `point_ledger`, `rewards`, and `redemptions` per `docs/superpowers/specs/2026-07-03-roles-and-store-design.md`. Kept for historical reference.

# Gamification Architecture — Tidy

**Status:** Approved  
**Supersedes:** `2026-06-29-gamification-design.md` (stale — contained an `AFTER DELETE` score reversal trigger that is replaced by an explicit RPC)

---

## Goal

Make chores feel rewarding without making roommates feel punished. Reward contribution, show friendly house-level progress, avoid blame. No global ranking, no public failure states.

---

## Backend Data Model

### `score_ledger`

Append-only event log. Never updated, never deleted by the application.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → profiles |
| `house_id` | `uuid` | FK → houses |
| `event_type` | `text` | enum: `chore_completion`, `chore_completion_reversal`, `streak_bonus` |
| `points` | `integer` | signed — positive for awards, negative for reversals |
| `chore_id` | `uuid` | nullable — null for streak bonuses |
| `for_date` | `date` | the chore's logical date, not wall clock time |
| `created_at` | `timestamptz` | default now() |

---

### `house_scores`

Denormalized fast-read leaderboard table. One row per user per house.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `uuid` | PK (composite) |
| `house_id` | `uuid` | PK (composite) |
| `score` | `integer` | maintained by trigger on `score_ledger` |

Updated automatically: whenever a row is inserted into `score_ledger`, a trigger increments `house_scores.score` by `score_ledger.points` (upsert).

---

### `user_streaks`

One row per user. Written by the `evaluate-streaks` Edge Function.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `uuid` | PK |
| `current_streak` | `integer` | days |
| `longest_streak` | `integer` | all-time best |
| `last_active_date` | `date` | last day the user completed all assigned chores |
| `updated_at` | `timestamptz` | |

---

## Scoring Flow

### Completion path

1. Client inserts into `chore_completions` (existing behavior, unchanged).
2. Postgres `AFTER INSERT` trigger fires on `chore_completions`.
3. Trigger calculates points:
   - `chore.due_date < for_date` → overdue → **+15**
   - otherwise → **+10**
4. Trigger inserts one row into `score_ledger` with `event_type = 'chore_completion'`.
5. `score_ledger` `AFTER INSERT` trigger upserts `house_scores`.

### Undo path

**Critical:** No `AFTER DELETE` trigger on `chore_completions`. Cascade deletes must not affect historical scoring.

1. Client calls `supabase.rpc('undo_chore_completion', { chore_id, for_date })`.
2. RPC (`SECURITY DEFINER`) verifies the completion row belongs to `auth.uid()`.
3. RPC deletes the `chore_completions` row.
4. RPC inserts a reversal into `score_ledger`:
   - `event_type = 'chore_completion_reversal'`
   - `points = -10` or `-15` (matching original award)
5. `score_ledger` trigger updates `house_scores`.

This means the ledger always has a full audit trail: completion + reversal pairs are explicit, not implied by deletes.

---

## Streak Flow

A scheduled Edge Function `evaluate-streaks` runs **daily at 02:00 UTC** (early morning in all US timezones).

For each user with a push token (active users):

1. Resolve user's local yesterday using `profiles.timezone`.
2. Query chores assigned to this user that were active on local yesterday.
3. **No assigned chores yesterday** → neutral day. No streak change.
4. **All assigned chores completed yesterday:**
   - if `last_active_date = yesterday - 1 day` → `current_streak += 1`
   - otherwise → `current_streak = 1` (new streak)
   - if `current_streak > longest_streak` → update `longest_streak`
   - set `last_active_date = yesterday`
5. **Assigned chores existed but some were incomplete:**
   - `current_streak = 0`

### Streak milestone bonuses

When `current_streak` hits a milestone, insert a `streak_bonus` into `score_ledger`:

| Milestone | Bonus |
|-----------|-------|
| 7 days | +50 |
| 30 days | +200 |

Milestone insert is idempotent — check `score_ledger` for an existing `streak_bonus` for that user at that milestone before inserting.

---

## Client Hooks

### `useTodayPoints(userId, houseId)`

Sums `score_ledger.points` for `user_id` where `for_date = today`. Used on the Home avatar badge. Real-time subscription on `score_ledger`.

### `useMyScore(userId, houseId)`

Reads `house_scores.score` for this user+house. Real-time subscription.

### `useStreak(userId)`

Reads `user_streaks` for this user. Refreshed on focus.

### `useLeaderboard(houseId, window: 'allTime' | 'week')`

- `allTime` → read from `house_scores`, join `profiles` for name/avatar
- `week` → aggregate `score_ledger` by `user_id` for `for_date >= start of current week`

---

## UI Architecture

Existing 3-tab structure is unchanged. No new tab.

### Home tab

| Element | Change |
|---------|--------|
| Avatar badge | Replace chore-count number with today's points |
| Own avatar only | Show streak flame `🔥 4` beside badge |
| Chore completion | Show floating `+10` or `+15` pill that fades out (no confetti) |

### House tab

Add a "This House" leaderboard section below the member list.

**Personal stats row** (top of leaderboard section):
- Total points
- Longest streak

**Leaderboard rows:**
- Rank number
- Avatar (with personal color ring)
- Display name
- Score
- Current streak (flame icon if > 0)

**Toggle:** All time | This week

---

## Security / RLS

All scoring writes go through backend only (triggers, RPCs, Edge Functions). No client-side insert/update on score tables.

| Table | Client read | Client write |
|-------|-------------|--------------|
| `score_ledger` | House members only | None |
| `house_scores` | House members only | None |
| `user_streaks` | House members only | None |

Read policy pattern: `house_id IN (SELECT house_id FROM house_members WHERE user_id = auth.uid())`.

---

## Implementation Order

### Phase 1 — Foundation (backend + hooks, no UI)

1. **Migration**
   - Create `score_ledger`, `house_scores`, `user_streaks`
   - Add RLS policies
   - Add `AFTER INSERT` trigger on `chore_completions` → writes `score_ledger`
   - Add `AFTER INSERT` trigger on `score_ledger` → upserts `house_scores`
   - Add `undo_chore_completion` RPC

2. **Update client undo path**
   - Replace direct `.delete()` in `undoMarkDone` with `supabase.rpc('undo_chore_completion')`

3. **Edge Function: `evaluate-streaks`**
   - Reuse `_shared/is-chore-active.ts`
   - Per-user timezone resolution
   - Upsert `user_streaks`, insert milestone bonuses

4. **TypeScript types** — add gamification tables to `types/database.ts`

5. **Hooks** — `useTodayPoints`, `useMyScore`, `useStreak`, `useLeaderboard`

### Phase 2 — UI

6. **Home tab:** points badge, streak flame, `+10`/`+15` floating pill
7. **House tab:** personal stats row, leaderboard with toggle

---

## Key Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| No `AFTER DELETE` trigger | Cascade deletes (house leave, account delete) should not corrupt the score ledger. Reversals must be explicit and auditable. |
| Append-only ledger | Enables audit trail, debugging, future "points history" feature, and easy week/month windowed aggregations. |
| Separate `house_scores` denorm table | Avoids full ledger aggregation on every leaderboard load. |
| No global leaderboard | Avoids public shaming. House-only keeps stakes low and social. |
| `evaluate-streaks` runs at 02:00 UTC | Covers midnight for all US timezones. Uses local yesterday to avoid off-by-one across timezones. |
| Milestone idempotency check | Edge Function may retry on failure — prevents duplicate milestone bonuses. |
