# MVP Cleanup — Design Document

**Goal:** Bring the Tidy codebase to a clean, shippable MVP state: no dead code, no fake UI, no unverified backend dependencies, no messy git history, and enough test coverage to trust the notification logic.

---

## 1. Git Staging Pass

**Problem:** 28 modified files and 7 untracked legitimate files are all uncommitted. `.claude/worktrees/` must stay out; all new product files must go in.

**Decision:** Commit in two logical passes so the history is readable.

### Commit A — MVP infrastructure (backend + types + config)
Stage only:
```
types/database.ts
lib/chores.ts
lib/house.ts
lib/house-events.ts
hooks/useAuth.ts
hooks/useChores.ts
hooks/useHouse.ts
lib/notifications.ts
context/                          (entire directory)
supabase/migrations/20260624000001_add_days_of_week.sql
supabase/migrations/20260624000002_join_house_by_code.sql
supabase/functions/_shared/is-chore-active.ts
supabase/functions/notify-due-today/index.ts
supabase/functions/notify-overdue/index.ts
tsconfig.json
package.json
package-lock.json
.gitignore
__tests__/lib/chores.test.ts
__tests__/lib/is-chore-active.test.ts
__tests__/app/                    (entire directory)
```
Message: `feat: MVP data model, RLS-safe join, notification scheduling`

### Commit B — UI/screens
Stage only:
```
app.json
app/_layout.tsx
app/(app)/_layout.tsx
app/(app)/index.tsx
app/(app)/chores.tsx
app/(app)/house.tsx
app/no-house.tsx
app/(auth)/onboarding.tsx
components/chores/AddChoreSheet.tsx
components/chores/AvatarRow.tsx
components/chores/ChoreCard.tsx
components/chores/ChoreList.tsx
components/chores/HeroCard.tsx
components/chores/WeekStrip.tsx
components/ui/TidyLogo.tsx
constants/theme.ts
```
Message: `feat: MVP screens — home, chores manager, house settings`

**Verify after staging:** `git status` must show `.claude/` as untracked (gitignored) and nothing unexpected staged.

---

## 2. Remove Dead Hook Functions

**Problem:**
- `inviteByEmail` in [hooks/useHouse.ts:78](../hooks/useHouse.ts) calls `supabase.rpc('invite_to_house')` — no matching migration exists, no UI calls it. It will silently fail in production.
- `changeHouseCode` in [hooks/useHouse.ts:91](../hooks/useHouse.ts) selects from `houses` by code without RLS protection, same class of bug that prompted the `join_house_by_code` RPC. No UI calls it.

**Decision:** Remove both functions for MVP. Neither is wired to UI, neither has a backend. Dead surface area is a liability.

**Changes:**
- Before deletion, confirm zero callers across the entire repo:
  ```bash
  rg "inviteByEmail|changeHouseCode"
  ```
  Expected: only the two definition sites in `hooks/useHouse.ts`. Run again after deletion to confirm nothing was missed.
- Delete `inviteByEmail` body and its return entry in [hooks/useHouse.ts:106](../hooks/useHouse.ts).
- Delete `changeHouseCode` body and its return entry.
- Update the return type to remove both names.

---

## 3. Eliminate `as any` Casts

**Problem:** `assigned_profile` is accessed via `(chore as any).assigned_profile` in two places:
- [app/(app)/index.tsx:139](../app/(app)/index.tsx)
- [app/(app)/chores.tsx:145](../app/(app)/chores.tsx)

`assigned_profile` already exists on `Chore` in [types/database.ts:41](../types/database.ts) as `assigned_profile?: Profile`. The cast is unnecessary — Supabase populates it via the joined select `profiles!assigned_to(*)` in `useChores.ts`.

**Decision:** Remove both `as any` casts. Access `chore.assigned_profile?.avatar_color_index` directly. This restores proper type checking on those two lines.

**Changes:** Two one-line edits. No type file changes required.

---

## 4. Supabase Migration Deployment

**Problem:** The app now depends on:
1. `days_of_week integer[]` column on `chores` (migration `20260624000001`)
2. `join_house_by_code` security-definer function (migration `20260624000002`)

These only exist in the local migration files. The live Supabase project has not been updated. Until applied, joining by code will silently fail and weekly chores with selected days will not persist.

**Required action (manual, outside this codebase):**

```bash
# Apply to live project
supabase db push

# Or via SQL editor in Supabase dashboard — paste each migration file in order:
# 1. supabase/migrations/20260624000001_add_days_of_week.sql
# 2. supabase/migrations/20260624000002_join_house_by_code.sql
```

**Verify in Supabase dashboard:**
- `chores` table has a `days_of_week` column of type `_int4` (integer array), nullable.
- Function `join_house_by_code` appears under Database → Functions with `SECURITY DEFINER`.

---

## 5. Smoke Test Plan

After migrations are applied, run through the following manually on a real device or simulator connected to the live Supabase project. No emulator/mock — these verify the RLS paths that tests cannot.

| # | Step | Expected |
|---|------|----------|
| 1 | Sign up with a new email | Onboarding screen appears, profile created |
| 2 | Create a house named "Test House" | House screen shows code (format: `TIDY-XXXX`), member list shows you |
| 3 | Tap "Share Code" | Share sheet shows `Join my house on Tidy!\n\nCode: TIDY-XXXX\nhttps://tidy.app/join/TIDY-XXXX` |
| 4 | Sign up with a second account, enter code on no-house screen | Second user joins, appears in first user's member list |
| 5 | Create a one-time chore with due date tomorrow | Chore appears in Chores manager under "One Time" group |
| 6 | Create a weekly chore, select Mon + Wed | Chore appears in Chores manager under "Weekly" group, days label shows "Mo · We" |
| 7 | Navigate to home screen, select today | Correct chores appear based on schedule |
| 8 | Mark a chore done | Checkmark appears, progress dot updates |
| 9 | Leave house from house settings | Second user's member slot disappears from first user's view; second user lands on no-house screen |
| 10 | Rejoin using same code | Works without error |

---

## 6. Notification Date Logic — Verification

**Problem:** `notify-due-today` and `notify-overdue` contain timezone-aware date logic that runs as a Deno edge function. TypeScript excludes `supabase/functions/` from compilation, and Jest does not cover it.

**Decision for MVP:** Extract the day-matching predicate into a standalone pure function that can be tested without Supabase or Deno. Keep the edge functions thin orchestrators.

### Extracted helper (same logic, testable in isolation)

Create `supabase/functions/_shared/is-chore-active.ts`:

```ts
export interface ChoreRow {
  due_date: string | null
  frequency: 'daily' | 'weekly'
  days_of_week: number[] | null
  created_at: string
}

/**
 * Returns true if a chore should be active on the given local date.
 * @param chore  - chore record from the database
 * @param localDate - YYYY-MM-DD string in the user's local timezone
 * @param localDayOfWeek - 0=Sun … 6=Sat, derived from the same local date
 */
export function isChoreActiveOnDate(
  chore: ChoreRow,
  localDate: string,
  localDayOfWeek: number
): boolean {
  if (chore.due_date) return chore.due_date === localDate
  if (chore.created_at.slice(0, 10) > localDate) return false
  if (chore.frequency === 'daily') return true
  if (chore.frequency === 'weekly') {
    if (chore.days_of_week?.length) return chore.days_of_week.includes(localDayOfWeek)
    return true // legacy: no days_of_week means all week
  }
  return false
}
```

Both `notify-due-today` and `notify-overdue` import and call this instead of inline logic.

### Tests

Add `__tests__/lib/is-chore-active.test.ts` (runs under Jest, no Deno needed):

Test cases:
- One-time chore: true on due_date, false on any other date
- Daily: true every day, false before created_at
- Weekly with days_of_week: true only on matching weekdays
- Weekly without days_of_week (legacy): true any day of the week
- Weekly: false before created_at regardless of day

---

## Summary

| # | Item | Files changed | Risk |
|---|------|--------------|------|
| 1 | Git staging | — | Low — careful staging, no code change |
| 2 | Remove dead hooks | `hooks/useHouse.ts` | Low — zero callers confirmed |
| 3 | Remove `as any` | `app/(app)/index.tsx`, `app/(app)/chores.tsx` | Low — type already defined |
| 4 | Deploy migrations | Supabase dashboard | Medium — manual step, needs verification |
| 5 | Smoke test | — | N/A — manual |
| 6 | Extract + test notification predicate | `supabase/functions/_shared/is-chore-active.ts`, `__tests__/lib/is-chore-active.test.ts`, `notify-due-today/index.ts`, `notify-overdue/index.ts` | Low — pure function extraction, no behavior change |
