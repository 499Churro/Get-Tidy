# Completions Fetch Fix & Date Utils Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a shared date utility, replace three duplicate local date helpers, and scope the completions fetch in `useChores` to a ±7-day window so the app doesn't download all historical completions on every refresh.

**Architecture:** Two focused commits. (1) Create `lib/dateUtils.ts` with `todayLocalISO()` and `offsetDate()`, replace the three copy-pasted local implementations across `index.tsx`, `chores.tsx`, and `ChoreCard.tsx`. (2) In `useChores.ts`, add `selectedDate` to `fetchAll`'s `useCallback` deps and filter the completions query to `[selectedDate − 7, selectedDate + 7]`. OTA release happens only after device smoke test passes — not automatically after commit.

**Tech Stack:** React Native, Expo SDK 56, TypeScript, Supabase JS client, Jest

---

## File Map

| File | Change |
|------|--------|
| `lib/dateUtils.ts` | **Create** — `todayLocalISO()`, `offsetDate()` |
| `__tests__/lib/dateUtils.test.ts` | **Create** — unit tests for both helpers |
| `hooks/useChores.ts` | **Modify** — add `selectedDate` to `fetchAll`'s `useCallback` deps, add date window filter to completions query |
| `app/(app)/index.tsx` | **Modify** — replace local `todayISO()` with `todayLocalISO` import |
| `app/(app)/chores.tsx` | **Modify** — replace local `todayISO()` with `todayLocalISO` import |
| `components/chores/ChoreCard.tsx` | **Modify** — replace local `localDateISO()` with `todayLocalISO` import |

---

## Task 1: Commit in-flight work (no OTA push)

Unrelated in-flight changes (momentum context, undo fix, avatar badge, profile cache, channel name fixes) are sitting uncommitted. Stage and commit them now so they don't contaminate the date/fetch commits. Do **not** push an EAS OTA update yet — that happens after all tasks are complete and device smoke passes.

**Files:** currently modified/untracked files shown in `git status`

- [ ] **Step 1: Verify git status shows expected files**

```bash
git status --short
```

Expected output includes:
```
 M app/(app)/_layout.tsx
 M app/(app)/house.tsx
 M app/(app)/index.tsx
 M components/chores/AvatarRow.tsx
 M hooks/useAuth.ts
 M hooks/useHouseMomentum.ts
 M hooks/useMonthlyGoal.ts
 M hooks/useTodayPoints.ts
?? context/MomentumContext.tsx
```

If unexpected files appear, investigate before staging — do not add unknown files.

- [ ] **Step 2: Stage and commit**

```bash
git add \
  "app/(app)/_layout.tsx" \
  "app/(app)/house.tsx" \
  "app/(app)/index.tsx" \
  "components/chores/AvatarRow.tsx" \
  "hooks/useAuth.ts" \
  "hooks/useHouseMomentum.ts" \
  "hooks/useMonthlyGoal.ts" \
  "hooks/useTodayPoints.ts" \
  "context/MomentumContext.tsx"

git commit -m "feat: shared momentum context, undo bar fix, avatar badge, progress card, profile cache"
```

- [ ] **Step 3: Confirm clean status**

```bash
git status --short
```

Expected: empty (no modified or untracked files from the previous session).

---

## Task 2: Create `lib/dateUtils.ts`

A single shared module for all local-date needs. Two exports:

- `todayLocalISO()` — returns `YYYY-MM-DD` in the device's local timezone using local date getters (same approach as the three functions it replaces — deterministic, no Intl dependency).
- `offsetDate(dateISO, days)` — shifts a `YYYY-MM-DD` string by ±N days using UTC arithmetic to avoid DST edge cases.

**Files:**
- Create: `lib/dateUtils.ts`
- Create: `__tests__/lib/dateUtils.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/dateUtils.test.ts`:

```ts
import { todayLocalISO, offsetDate } from '@/lib/dateUtils'

describe('todayLocalISO', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('matches local date getters', () => {
    const d = new Date()
    const expected = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-')
    expect(todayLocalISO()).toBe(expected)
  })
})

describe('offsetDate', () => {
  it('adds positive days', () => {
    expect(offsetDate('2026-06-28', 3)).toBe('2026-07-01')
  })

  it('subtracts negative days', () => {
    expect(offsetDate('2026-07-01', -3)).toBe('2026-06-28')
  })

  it('handles month-end rollover', () => {
    expect(offsetDate('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('zero offset returns the same date', () => {
    expect(offsetDate('2026-06-15', 0)).toBe('2026-06-15')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/lib/dateUtils.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/dateUtils'`

- [ ] **Step 3: Create `lib/dateUtils.ts`**

```ts
export function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Shifts a YYYY-MM-DD string by ±days using UTC arithmetic.
// UTC avoids DST clock-change edge cases when adding/subtracting days.
export function offsetDate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const result = new Date(Date.UTC(y, m - 1, d + days))
  return result.toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest __tests__/lib/dateUtils.test.ts --no-coverage
```

Expected: PASS — 6 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/dateUtils.ts __tests__/lib/dateUtils.test.ts
git commit -m "feat: add todayLocalISO and offsetDate to lib/dateUtils"
```

---

## Task 3: Replace duplicate date helpers with the shared util

Three files each define their own version of "what's today's local date":
- `app/(app)/index.tsx` — `todayISO()` at lines 21–24, called at lines 30 and 111
- `app/(app)/chores.tsx` — `todayISO()` at lines 44–47, called at line 56
- `components/chores/ChoreCard.tsx` — `localDateISO()` at lines 14–17, called at line 21

Note: `index.tsx` also has `d.toISOString().slice(0, 10)` at line 82 inside the WeekStrip dot-color `useMemo`. That line is UTC date arithmetic for computing a 7-day grid — leave it alone.

**Files:**
- Modify: `app/(app)/index.tsx`
- Modify: `app/(app)/chores.tsx`
- Modify: `components/chores/ChoreCard.tsx`

- [ ] **Step 1: Update `app/(app)/index.tsx`**

Add import after existing imports:
```ts
import { todayLocalISO } from '@/lib/dateUtils'
```

Delete the `todayISO` function definition (lines 21–24):
```ts
// DELETE:
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
```

Replace both call sites:
- `useState(todayISO())` → `useState(todayLocalISO())`
- `const today = todayISO()` → `const today = todayLocalISO()`

- [ ] **Step 2: Update `app/(app)/chores.tsx`**

Add import:
```ts
import { todayLocalISO } from '@/lib/dateUtils'
```

Delete the `todayISO` function definition (lines 44–47):
```ts
// DELETE:
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
```

Replace call site:
- `useChores(house?.id, todayISO())` → `useChores(house?.id, todayLocalISO())`

- [ ] **Step 3: Update `components/chores/ChoreCard.tsx`**

Add import:
```ts
import { todayLocalISO } from '@/lib/dateUtils'
```

Delete the `localDateISO` function definition (lines 14–17):
```ts
// DELETE:
function localDateISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
```

Replace call site:
- `const today = localDateISO()` → `const today = todayLocalISO()`

- [ ] **Step 4: Confirm TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/index.tsx" "app/(app)/chores.tsx" "components/chores/ChoreCard.tsx"
git commit -m "refactor: replace duplicate todayISO helpers with shared todayLocalISO"
```

---

## Task 4: Scope the completions fetch to a ±7-day window

**The problem:** `useChores.ts` fetches every `chore_completion` row for the house with no date filter. After months of use this grows into hundreds of rows downloaded on every tab switch or real-time event. `selectedDate` is also missing from `fetchAll`'s `useCallback` deps — once we add the window, navigating to a new date must trigger a refetch or completions outside the initial window will be absent.

**The fix:**
1. Add `selectedDate` to `fetchAll`'s `useCallback` deps only. The `useEffect` already depends on `fetchAll`, so a new `fetchAll` reference (caused by `selectedDate` changing) cascades automatically — no change to the `useEffect` deps array is needed.
2. Add `.gte('for_date', windowStart).lte('for_date', windowEnd)` to the completions query. The ±7 day window covers the entire WeekStrip (always 7 days wide) plus one day on each side as a navigation buffer. It does not cover arbitrary historical data — that's the point.

**Files:**
- Modify: `hooks/useChores.ts`

- [ ] **Step 1: Update `hooks/useChores.ts`**

Add import at top (after existing imports):
```ts
import { offsetDate } from '@/lib/dateUtils'
```

Inside `fetchAll`, replace the unbounded completions query (around lines 29–31):

```ts
// BEFORE:
const { data: completionData } = choreIds.length > 0
  ? await supabase.from('chore_completions').select('*').in('chore_id', choreIds)
  : { data: [] }
```

```ts
// AFTER:
const windowStart = offsetDate(selectedDate, -7)
const windowEnd   = offsetDate(selectedDate,  7)
const { data: completionData } = choreIds.length > 0
  ? await supabase
      .from('chore_completions')
      .select('*')
      .in('chore_id', choreIds)
      .gte('for_date', windowStart)
      .lte('for_date', windowEnd)
  : { data: [] }
```

Add `selectedDate` to `fetchAll`'s `useCallback` deps (around line 39):

```ts
// BEFORE:
}, [houseId])

// AFTER:
}, [houseId, selectedDate])
```

Do not change the `useEffect` deps array — it already contains `fetchAll`, so a new `fetchAll` reference cascades the refetch automatically.

- [ ] **Step 2: Confirm TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run the existing chores tests**

```bash
npx jest __tests__/lib/chores.test.ts --no-coverage
```

Expected: PASS — all existing tests still passing (these test pure functions, not Supabase queries)

- [ ] **Step 4: Commit**

```bash
git add hooks/useChores.ts
git commit -m "perf: scope chore completions fetch to ±7-day window around selected date"
```

---

## Task 5: Device smoke test, then OTA push

Run a manual smoke test on simulator and device before publishing the EAS Update. Only push if all items pass.

- [ ] **Step 1: Smoke test on simulator**

Start the dev server:
```bash
npx expo start
```

Open in Expo Go (simulator). Verify:
- [ ] Chores tab loads — today's chores visible
- [ ] Tapping a different day in the WeekStrip shows the correct chores and completion dots
- [ ] Marking a chore done shows the check, star animation fires, progress bar increases
- [ ] Undoing a chore removes the check and progress bar decreases immediately
- [ ] Home tab and House tab show the same active_days / target_days value

- [ ] **Step 2: Push EAS Update to production branch**

Only run this after smoke test passes:

```bash
npx eas update --branch production --environment production --message "date utils + completions fetch window"
```

This publishes an OTA update to the `production` EAS channel. Users on a compatible runtime version will receive it on next app launch — it is not a TestFlight submission.
