> **SUPERSEDED** — This spec explored `house_scores`, leaderboards, and an earlier gamification model that was replaced by the point ledger + reward store direction. Superseded by `docs/superpowers/specs/2026-07-03-roles-and-store-design.md`. Kept for historical reference.

# Tidy — Phase 2 Gamification Design

**Date:** 2026-06-29
**Scope:** Phase 2 — Streaks, scores, leaderboard, completion celebrations
**Depends on:** Phase 2 readiness doc (backend schema, Part B) must be deployed first
**Stack:** Expo (React Native) + Supabase (existing)

---

## 1. Design Principles (carry-forward from PRD)

- **Punch the chore, not the person.** Scores and streaks reflect contribution, never shame. No "you broke the house streak" messaging. No naming who dropped the ball.
- **The app is the scoreboard, not the referee.** Surface data clearly. Let roommates draw their own conclusions.
- **Playful, not punitive.** A broken streak resets quietly. A completed chore celebrates loudly.
- **Frictionless by default.** Gamification is visible but never adds steps to the core loop (log chore = 2 taps).

---

## 2. What Phase 2 Adds

| Feature | Where | Description |
|---------|-------|-------------|
| Points badge on avatars | Home tab | Replace 0/1 chore count with today's points earned |
| Streak flame on own avatar | Home tab | Show current streak count next to your avatar |
| Completion celebration | Home tab | Brief animation + points popup when you check off a chore |
| Leaderboard | House tab | Full ranking of all roommates by score + streak |
| Score total on profile | House tab | Your all-time score and longest streak on the member row |
| Weekly score toggle | House tab leaderboard | Switch between all-time and this-week view |

**Navigation stays at 3 tabs.** Gamification is integrated into existing screens rather than adding a 4th tab. The leaderboard belongs in House — it's house-level social data, not a daily-use surface.

---

## 3. Home Tab Changes

### 3a. Avatar Row — Badge Redesign

**Current:** Badge shows `done/total` chore count for today (e.g. `0/3`).

**New:** Badge shows today's points earned (e.g. `+30`). When the user has earned 0 points today, show `0`.

Rationale: the chore count badge was functionally redundant with the chore list below it. Points are more motivating and align with the gamification model.

**Streak flame:** Your own avatar gets a small streak indicator below the name label. Shows 🔥 + streak count. Only visible on your own avatar (isMe), not on others — keeps focus on personal motivation, not comparison pressure.

```
[Avatar with ring]   [Avatar with ring]
[badge: +30]         [badge: +10]
  Alex                  You 🔥 4
```

Empty state for streak: no flame shown until the user has a streak ≥ 1.

### 3b. Completion Celebration

When a chore is marked done, trigger:

1. **Checkmark animation** — the radio button scales up and fills with the accent color (spring animation, ~300ms). Already partially implemented.
2. **Points popup** — a small pill (`+10` or `+15 overdue`) floats up from the checkmark and fades out. Duration: 600ms. Does not block interaction.
3. **No confetti** — confetti is distracting and breaks the calm, minimal aesthetic. The pill is enough.

Points popup positioning: absolute, appears at the tap point, fades out upward. Implemented with `react-native-reanimated` (already installed).

**Milestone celebrations (streak milestones only):**
- 7-day streak reached: full-screen overlay for 1.5s. Copy: *"7-day streak 🔥 +50 bonus points"*. Dismiss on tap or auto-dismiss.
- 30-day streak: same treatment, copy: *"30-day streak ⚡ +200 bonus points"*.
- Streaks beyond 30: no additional milestone celebrations in Phase 2.

Milestone overlay is checked on app open by comparing `current_streak` against known milestones — not on every completion (streak updates run nightly, not real-time).

---

## 4. House Tab — Leaderboard Section

### 4a. Placement

New section below "Roommates" and above "Notifications". Section title: **"This House"**.

### 4b. Leaderboard Card

Full-width card showing all house members ranked by score. Each row:

```
[Avatar]  [Name]          Score    Streak
           Alex           1,240    🔥 12
           You            980      🔥 4
           Jordan         400      —
```

- Rank numbers (1st, 2nd, 3rd) shown as small text to the left of the avatar.
- Your row is subtly highlighted (accent color left stripe, same pattern as chore cards).
- Score displays with commas for readability.
- Streak shows flame + count. If streak is 0, shows `—`.
- No rank change indicators in Phase 2 (arrows up/down). Keep it simple.

**Score toggle:** Two-segment control at top of leaderboard card: `All time` | `This week`.

- All-time: reads from `house_scores` table (pre-aggregated, fast).
- This week: queries `score_ledger` summed by `user_id` where `created_at >= start of current week (Monday 00:00 UTC)`.
- Default: All time.

### 4c. Your Stats Row

Directly above the leaderboard, inside the "This House" card, a compact personal stats row:

```
Longest streak: 14 days    |    Total points: 1,240
```

Single row, muted label + bold value. Pulled from `user_streaks` and `house_scores`.

---

## 5. Data Flow (client side)

### 5a. New hooks

**`useLeaderboard(houseId, window: 'alltime' | 'week')`**
- All-time: `select * from house_scores where house_id = ? join profiles`. Supabase realtime subscription — updates live when another member completes a chore.
- Week: `select sum(points), user_id from score_ledger where house_id = ? and created_at >= [Monday] group by user_id`. No realtime — refetch on pull-to-refresh.

**`useStreak(userId)`**
- `select * from user_streaks where user_id = ?`. No realtime — once per day cadence.
- Returns `{ current_streak, longest_streak, last_active_date }`.

**`useMyScore(userId, houseId)`**
- `select score from house_scores where user_id = ? and house_id = ?`. Realtime subscription — updates when you earn points.
- Used for the points badge on the avatar row and personal stats.

### 5b. Where today's points come from

The badge shows points earned **today** — not all-time score. This requires querying `score_ledger` for `user_id = me AND created_at >= today_start`. A lightweight query, can be polled on focus or subscribed to real-time.

**New hook: `useTodayPoints(userId, houseId)`** — returns sum of `score_ledger.points` where `created_at >= today 00:00 local`.

Note: timezone handling — `today_start` must be computed in the user's local timezone, not UTC. Use the stored `profiles.timezone` field for this.

### 5c. Points popup data source

When `markDone` is called in `useChores`, the RPC/trigger awards points server-side. The client doesn't know the awarded amount until it can read from `score_ledger`. Two options:

- **Option A (recommended):** Optimistically assume `+10`. If the chore was overdue and the server awards `+15`, the next poll reconciles. Simpler, no extra round-trip.
- **Option B:** After `markDone` resolves, query `score_ledger` for the most recent row for this user. Show actual points. Adds ~200ms latency to the animation.

Recommendation: Option A. The `+5` overdue bonus is cosmetic. Speed of celebration matters more.

---

## 6. State Transitions and Edge Cases

| Case | Behavior |
|------|----------|
| User has no chores today | Badge shows `0`, no streak disruption |
| User has chores but none completed | Badge shows `0` |
| Chore marked done, then undone | Points popup fires on done. On undo, `score_ledger` row is deleted by the `undo_chore_completion` RPC. Badge updates. No negative animation. |
| Streak broken (missed a day) | `current_streak` resets to 0 server-side at midnight. Client reads this on next app open. No notification sent for broken streak — silent reset. |
| Two users complete same chore | Both earn points. `chore_completions` allows multiple completers per `for_date` per chore (by different users). `score_ledger` gets one row per completer. |
| House has 1 member | Leaderboard shows a single row. Still renders — valid state. |
| New member joins mid-season | Starts at 0 score. No backfill. Oldest member advantage is a feature (tenure is worth something). |

---

## 7. Undo Chore Completion — Score Reversal

The existing `undoMarkDone` flow deletes from `chore_completions`. The `score_ledger` row must also be removed — add an `after delete` trigger on `chore_completions` that deletes the corresponding `score_ledger` entry (matched by `chore_id` + `user_id` + `created_at` proximity). The `house_scores` trigger handles the decrement automatically via the same cascade.

**Note for implementation:** The `award_completion_points` trigger stores the `chore_id`. The reversal trigger should match on `chore_id + user_id + for_date` to find the right ledger row. `for_date` must be stored on `score_ledger` to make this join unambiguous. Add `for_date date` column to `score_ledger` schema.

---

## 8. Open Questions — Decisions Required Before Build

| # | Question | Recommendation |
|---|----------|---------------|
| 1 | Days with no assigned chores: count as maintained streak or neutral? | **Neutral** (skip). No obligation = no credit or penalty. |
| 2 | Do scores ever reset? | **No reset in Phase 2.** Cumulative all-time. The "This week" toggle satisfies short-term motivation without destroying history. |
| 3 | Retroactive streaks/scores for existing completions? | **No backfill.** Clean start from deploy date. Existing users get a fresh slate. Announce it as "gamification launches today." |
| 4 | Who sees the leaderboard? | **All house members.** It's per-house only. No cross-house comparison. |
| 5 | Milestone overlay: once per session or once ever? | **Once ever** — store milestone achieved in `user_streaks` or a local flag. Don't re-show on every app open. |

---

## 9. Implementation Order

All backend work (Part B from the readiness doc) must be merged and deployed before any frontend work begins.

### Backend (Phase 2 Readiness Part B — prerequisite)
- [ ] Migration: `user_streaks`, `score_ledger` (with `for_date`), `house_scores`, RLS, award trigger, score-reversal trigger
- [ ] Edge Function: `evaluate-streaks` (nightly cron)
- [ ] Types: `UserStreak`, `ScoreLedgerEntry`, `HouseScore` in `types/database.ts`

### Frontend (Phase 2 UI — this spec)
- [ ] `useTodayPoints` hook
- [ ] `useStreak` hook
- [ ] `useLeaderboard` hook (all-time + week modes)
- [ ] Avatar row badge redesign (today's points)
- [ ] Streak flame on own avatar label
- [ ] Points popup animation on chore completion
- [ ] Milestone overlay (7-day, 30-day)
- [ ] Leaderboard card in House tab
- [ ] Personal stats row in House tab
- [ ] Score toggle (all-time / this week)

---

## 10. Out of Scope for Phase 2

- Rotation logic (auto-reassign chores round-robin)
- Cross-house leaderboards or global rankings
- Score decay or expiry
- Custom point values per chore
- Achievements / badges beyond streak milestones
- Social sharing of scores
- Chore difficulty ratings
