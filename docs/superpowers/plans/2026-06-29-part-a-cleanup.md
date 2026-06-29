# Part A Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 6 pre-gamification cleanup fixes approved in `docs/phase2-readiness-design.md` (with reviewer corrections).

**Architecture:** All changes are isolated fixes in existing files. No new files, no new abstractions. Each task is a targeted diff.

**Tech Stack:** Expo SDK 56, React Native, TypeScript, Supabase, npm

**Spec:** `docs/phase2-readiness-design.md` Part A

---

## Execution order

Tasks 1–5 are code changes. Task 6 commits everything (modified tracked + untracked) and deploys the migration. Do not commit between tasks 1–5 — one clean commit at the end.

---

## Task 1: Pin `@types/jest` and update lockfile (A1)

**Files:**
- Modify: `package.json`
- Update: `package-lock.json` (via npm install)

- [ ] **Step 1: Update the version string**

In `package.json` line 43, change:
```json
"@types/jest": "^30.0.0",
```
to:
```json
"@types/jest": "29.5.14",
```

- [ ] **Step 2: Regenerate the lockfile**

```bash
npm install
```

Expected: lockfile updates `@types/jest` to exactly `29.5.14`. No other dependency changes.

- [ ] **Step 3: Verify TypeScript still passes**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

---

## Task 2: Remove broken web build config (A2)

**Files:**
- Modify: `package.json` (remove `web` script)
- Modify: `app.json` (remove `web` block)

- [ ] **Step 1: Remove `web` from scripts in `package.json`**

In `package.json` `"scripts"` block, remove the line:
```json
"web": "expo start --web"
```

The scripts block should end up with only: `start`, `android`, `ios`.

- [ ] **Step 2: Remove `web` block from `app.json`**

In `app.json`, remove lines 40–42:
```json
"web": {
  "bundler": "metro"
},
```

- [ ] **Step 3: Verify expo doctor is happy**

```bash
npx expo-doctor
```

Expected: no web-related errors. (Ignore any unrelated warnings already present.)

- [ ] **Step 4: Verify dependency compatibility**

```bash
npx expo install --check
```

Expected: no output (all dependencies are compatible). This is the exact gate that caught the `@types/jest` mismatch.

---

## Task 3: Remove redundant completion pre-delete in `deleteChore` (A4)

**File:** `hooks/useChores.ts`

**Why:** `chore_completions` has `ON DELETE CASCADE` from `chores`. The client pre-delete on line 177 is redundant. If it silently errors, we proceed anyway — hiding a potential issue. Remove it; let the cascade do its job.

- [ ] **Step 1: Delete the pre-delete line**

In `hooks/useChores.ts`, replace the `deleteChore` function body:

Old:
```ts
async function deleteChore(choreId: string): Promise<{ error: string | null }> {
  await supabase.from('chore_completions').delete().eq('chore_id', choreId)
  const { error } = await supabase.from('chores').delete().eq('id', choreId)
  if (!error) await fetchAll()
  return { error: error?.message ?? null }
}
```

New:
```ts
async function deleteChore(choreId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('chores').delete().eq('id', choreId)
  if (!error) await fetchAll()
  return { error: error?.message ?? null }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no output.

---

## Task 4: Capture and log push token save error (A5)

**File:** `lib/notifications.ts`

**Why:** Line 37 fires `supabase.from('profiles').update(...)` and discards the result. If the write fails, `push_token` is never saved and notifications silently break. Capture the error, log it to console (enough for debugging), and return `null` so the caller knows registration didn't complete.

- [ ] **Step 1: Update the Supabase write**

In `lib/notifications.ts`, replace lines 37–38:

Old:
```ts
  await supabase.from('profiles').update({ push_token: token }).eq('id', userId)
  return token
```

New:
```ts
  const { error: saveError } = await supabase
    .from('profiles')
    .update({ push_token: token })
    .eq('id', userId)
  if (saveError) {
    console.error('[notifications] Failed to save push token:', saveError.message)
    return null
  }
  return token
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no output.

---

## Task 5: Fix stale `resetForm` closure in `AddChoreSheet` (A6)

**File:** `components/chores/AddChoreSheet.tsx`

**Why:** `useEffect` at line 68 calls `resetForm()` (line 88), but `resetForm` is declared with `useCallback` at line 92 — after the effect. More critically, `resetForm` is not in the `useEffect` dependency array, so if `currentUserId` changes, the effect runs with a stale version of `resetForm` that closes over the old `currentUserId`.

**Fix:** Move the `resetForm` `useCallback` above the `useEffect`, then add it to the dep array.

- [ ] **Step 1: Move `resetForm` above `useEffect` and add to dep array**

In `components/chores/AddChoreSheet.tsx`, replace the block spanning from the `useEffect` (line 68) through the end of `resetForm` (line 100):

Old:
```ts
    useEffect(() => {
      if (editingChore) {
        setName(editingChore.name)
        setAssignedTo(editingChore.assigned_to)
        setNotes(editingChore.notes ?? '')
        if (editingChore.due_date) {
          setRepeatMode('once')
          setOneTimeDate(new Date(editingChore.due_date + 'T00:00:00'))
        } else {
          const freq = editingChore.frequency === 'daily' ? 'weekly' : editingChore.frequency
          setRepeatMode(freq)
          setDaysOfWeek(
            editingChore.days_of_week?.length
              ? editingChore.days_of_week
              : editingChore.frequency === 'daily'
                ? [0, 1, 2, 3, 4, 5, 6]
                : [1]
          )
        }
      } else {
        resetForm()
      }
    }, [editingChore])

    const resetForm = useCallback(() => {
      setName('')
      setNotes('')
      setRepeatMode('weekly')
      setDaysOfWeek([1])
      setOneTimeDate(new Date())
      setShowDatePicker(false)
      setAssignedTo(currentUserId)
    }, [currentUserId])
```

New:
```ts
    const resetForm = useCallback(() => {
      setName('')
      setNotes('')
      setRepeatMode('weekly')
      setDaysOfWeek([1])
      setOneTimeDate(new Date())
      setShowDatePicker(false)
      setAssignedTo(currentUserId)
    }, [currentUserId])

    useEffect(() => {
      if (editingChore) {
        setName(editingChore.name)
        setAssignedTo(editingChore.assigned_to)
        setNotes(editingChore.notes ?? '')
        if (editingChore.due_date) {
          setRepeatMode('once')
          setOneTimeDate(new Date(editingChore.due_date + 'T00:00:00'))
        } else {
          const freq = editingChore.frequency === 'daily' ? 'weekly' : editingChore.frequency
          setRepeatMode(freq)
          setDaysOfWeek(
            editingChore.days_of_week?.length
              ? editingChore.days_of_week
              : editingChore.frequency === 'daily'
                ? [0, 1, 2, 3, 4, 5, 6]
                : [1]
          )
        }
      } else {
        resetForm()
      }
    }, [editingChore, resetForm])
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no output.

---

## Task 6: Commit everything and deploy migration (A3)

**Files:** All modified tracked files + all untracked files listed below.

**What to commit (full changeset):**

Modified tracked files (from previous bug-fix sessions + tasks 1–5 above):
- `app/(app)/house.tsx`
- `app/(app)/index.tsx`
- `app/(auth)/onboarding.tsx`
- `app/join/[code].tsx`
- `app/no-house.tsx`
- `components/chores/AddChoreSheet.tsx`
- `components/chores/ChoreCard.tsx`
- `components/chores/HeroCard.tsx`
- `hooks/useAuth.ts`
- `hooks/useChores.ts`
- `lib/notifications.ts`
- `package.json`
- `package-lock.json`
- `app.json`

Untracked files:
- `lib/pendingInvite.ts`
- `supabase/migrations/20260625000001_tighten_completion_rls.sql`
- `docs/audit-fixes-design.md`
- `docs/qa-followup-design.md`
- `docs/phase2-readiness-design.md`
- `docs/superpowers/plans/2026-06-29-part-a-cleanup.md`

- [ ] **Step 1: Final TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 2: Final test run**

```bash
npx jest --runInBand
```

Expected: all tests pass, no failures.

- [ ] **Step 3: Stage and commit**

```bash
git add \
  app/\(app\)/house.tsx \
  app/\(app\)/index.tsx \
  app/\(auth\)/onboarding.tsx \
  app/join/\[code\].tsx \
  app/no-house.tsx \
  components/chores/AddChoreSheet.tsx \
  components/chores/ChoreCard.tsx \
  components/chores/HeroCard.tsx \
  hooks/useAuth.ts \
  hooks/useChores.ts \
  lib/notifications.ts \
  lib/pendingInvite.ts \
  package.json \
  package-lock.json \
  app.json \
  supabase/migrations/20260625000001_tighten_completion_rls.sql \
  docs/audit-fixes-design.md \
  docs/qa-followup-design.md \
  docs/phase2-readiness-design.md \
  docs/superpowers/plans/2026-06-29-part-a-cleanup.md

git commit -m "fix: Part A pre-gamification cleanup

- Pin @types/jest to 29.5.14 (Expo SDK 56 requirement)
- Remove broken web build script and app.json web config
- Simplify deleteChore: remove redundant pre-delete, rely on ON DELETE CASCADE
- Capture and log push token save error in registerForPushNotifications
- Fix stale resetForm closure in AddChoreSheet: move useCallback above useEffect, add to dep array
- Add refreshProfile to AuthProvider and useAuth
- Fix heroIsActionable guard to prevent completing roommate chores
- Fix house screen blank state with houseLoading guard
- Fix HeroCard empty message grammar
- Fix ChoreCard local date ISO (was using UTC toISOString)
- Add try/catch/finally to AddChoreSheet handleSave
- Add AsyncStorage-backed pending invite code (survives OAuth redirects)
- Add in-flight guard (pendingRef) and exception rollback to markDone/undoMarkDone
- Tighten completion RLS: require house membership on insert"
```

- [ ] **Step 4: Deploy migration to live Supabase project**

```bash
supabase db push
```

Expected: output confirms `20260625000001_tighten_completion_rls.sql` was applied. If already applied, it will say "No pending migrations."

- [ ] **Step 5: Verify migration in Supabase dashboard**

In the Supabase dashboard → Table Editor → Authentication → Policies, confirm `chore_completions` has a policy named `completions: insert own` with a `house_id` check.
