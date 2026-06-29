# Audit Fixes — Design Document

**Goal:** Resolve all Critical and High findings from the project audit, clear the Medium findings that have correctness implications, and remove confirmed dead code. Low-severity cosmetic and coverage gaps are noted but not scheduled here.

Issues are grouped into seven self-contained tasks. Each task can be reviewed and approved independently.

---

## Task 1 — Centralize `todayISO` and Fix UTC Slice Bug in ChoreCard

**Severity:** Critical  
**Files:** `lib/dateUtils.ts` (new), `components/chores/ChoreCard.tsx`, `app/(app)/index.tsx`, `app/(app)/chores.tsx`

### Problem
There are two distinct issues here:

**A — Real timezone bug in `ChoreCard.tsx:16`:**
```ts
const today = new Date().toISOString().slice(0, 10)
```
`toISOString()` always returns a UTC timestamp. For a user in UTC+10 at 1 AM Wednesday, `toISOString().slice(0,10)` returns `Tuesday` — so the overdue badge fires a day early on any date boundary. This is the actual bug.

**B — DRY violation (not a bug):**
`todayISO()` is defined identically in `index.tsx:16` and `chores.tsx:37`. Both correctly use local getters (`getFullYear/getMonth/getDate`) and are not buggy. The duplication is still worth fixing for maintainability.

### Fix
Create `lib/dateUtils.ts`:

```ts
// Returns YYYY-MM-DD in the device's local timezone.
// Uses Intl.DateTimeFormat (en-CA locale) which produces YYYY-MM-DD natively
// and matches toLocaleDateString('en-CA') used in edge functions.
export function todayLocalISO(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date())
}
```

Three changes:
1. Fix `ChoreCard.tsx:16` — replace `new Date().toISOString().slice(0, 10)` with `todayLocalISO()`
2. Remove `todayISO()` from `index.tsx` and replace its two call sites with `todayLocalISO()`
3. Remove `todayISO()` from `chores.tsx` and replace its call site with `todayLocalISO()`

**No schema changes. No hook changes.**

---

## Task 2 — Scope Completion Fetch to a Date Window

**Severity:** Critical (performance bottleneck)  
**Files:** `hooks/useChores.ts`

### Problem
`useChores` fetches every `chore_completion` row for every chore in the house with no date filter (`useChores.ts:22`). A house active for six months with 10 chores and daily completions accumulates ~1,800 rows. Every tab switch, every real-time event, downloads all of them.

### Fix
Add a 14-day window filter on the completions fetch — one week back and one week forward covers every visible day in the WeekStrip plus any overdue chores from last week:

```ts
const windowStart = offsetDate(selectedDate, -7)   // 7 days before selected
const windowEnd   = offsetDate(selectedDate,  7)   // 7 days after selected

const { data: completionData } = choreIds.length > 0
  ? await supabase
      .from('chore_completions')
      .select('*')
      .in('chore_id', choreIds)
      .gte('for_date', windowStart)
      .lte('for_date', windowEnd)
  : { data: [] }
```

Add `offsetDate` helper to `lib/dateUtils.ts`:

```ts
export function offsetDate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const result = new Date(Date.UTC(y, m - 1, d + days))
  return result.toISOString().slice(0, 10)
}
```

**`fetchAll` must also re-run when `selectedDate` changes**, so add `selectedDate` to the `useCallback` dependency array and the `useEffect` dependency array.

Currently `selectedDate` is not in either — the hook only re-fetches when `houseId` changes, meaning switching days does not re-fetch completions for the new window. This is a secondary bug fixed by the same change.

---

## Task 3 — Fix Real-time Subscription Scope + Channel Name Leak

**Severity:** Critical (performance) + High (memory)  
**Files:** `hooks/useChores.ts`, `hooks/useHouse.ts`

### Problem A — Unfiltered completions subscription
`useChores.ts:41` subscribes to all `chore_completions` changes across the entire database:
```ts
.on('postgres_changes', { event: '*', schema: 'public', table: 'chore_completions' }, fetchAll)
```
Every completion by any user in any house triggers a re-fetch for all connected clients. With 100 houses × 5 users = 500 wakeups per completion event.

**Fix:** Filter by `chore_id` is not directly supported by Postgres CDC filters. The correct approach is to filter by a column on the `chore_completions` table that ties to the house. Two options:

- **Option A (schema change, preferred):** Add `house_id` column to `chore_completions` as a denormalized fast-filter column, populated by trigger or insert. Then filter: `filter: house_id=eq.${houseId}`.
- **Option B (no schema change):** Drop the real-time subscription for completions entirely. Instead, re-fetch completions optimistically on markDone/undoMarkDone (which already happens), and rely on the chore real-time subscription to keep the chore list fresh. Completions don't need to be real-time — they're only visible to the house and are write-once per day.

**Recommendation: Option B for MVP.** Removes the unscoped subscription with zero schema change. Real-time for chore list (adding/editing/deleting chores) is preserved. The only thing lost is seeing another roommate's completion checkmark update live — acceptable for MVP.

### Problem B — Channel name includes `Date.now()`
Both `useChores.ts:35` and `useHouse.ts:37` append `Date.now()` to channel names. On rapid remount (fast navigation), old channels are created but the cleanup `removeChannel` only removes the last one registered in the closure. Each stale channel holds a WebSocket listener.

**Fix:** Use a stable channel name and rely on React's cleanup guarantee — not Supabase client behavior — to prevent duplicates. `Date.now()` in the name makes every mount produce a unique string, which means the `removeChannel` in the cleanup function has no way to cancel a channel from a prior mount that used a different timestamp. Stable names make the cleanup unambiguous:
```ts
// useChores
const channel = supabase.channel(`chores:${houseId}`)
// useHouse  
const channel = supabase.channel(`house_members:${userId}`)
```
With stable names, the cleanup function's `removeChannel` call unambiguously cancels the channel the current effect opened. The real safety mechanism is the React `useEffect` cleanup running before the next effect fires — stable names just ensure the cleanup targets the right channel.

---

## Task 4 — Fix `join_house_by_code` Race Condition

**Severity:** High  
**Files:** `supabase/migrations/20260625000001_fix_join_race.sql` (new)

### Problem
The RPC checks membership then inserts in two separate statements with no exclusive lock (`migration 20260624000002`). Two concurrent calls from the same user (e.g., double-tap) slip past the `EXISTS` check simultaneously, both attempt the insert, and one gets a raw Postgres `23505` unique constraint violation that bubbles to the client as an unformatted error.

### Fix
Catch the unique violation explicitly inside the function and return a clean error:

```sql
create or replace function public.join_house_by_code(code_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_house_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'Not authenticated.');
  end if;

  select id into v_house_id
  from public.houses
  where code = upper(code_input);

  if v_house_id is null then
    return jsonb_build_object('error', 'House not found. Check your code and try again.');
  end if;

  begin
    insert into public.house_members (house_id, user_id)
    values (v_house_id, v_user_id);
  exception when unique_violation then
    return jsonb_build_object('error', 'You''re already in a house. Leave your current house first.');
  end;

  return jsonb_build_object('house_id', v_house_id, 'error', null);
end;
$$;
```

This removes the check-then-insert pattern entirely. The UNIQUE constraint on `house_members(user_id)` is the single source of truth. The `exception` block catches the violation and returns a clean message. No TOCTOU window.

**One new migration file. No app code changes.**

---

## Task 5 — Fix `markDone` Double-tap Race + RLS Completion Gap

**Severity:** High  
**Files:** `hooks/useChores.ts`

### Problem A — Double-tap race
Tapping a chore twice before the first request completes adds two optimistic completions with the same key `optimistic-${choreId}-${selectedDate}`. Rollback uses `filter(c => c.id !== optimistic.id)` which only removes the last one — the stale entry persists until the next full re-fetch.

**Fix:** Track in-flight chore IDs in a `Set` and guard the entry point:

```ts
const pendingRef = useRef<Set<string>>(new Set())

async function markDone(choreId: string, userId: string): Promise<void> {
  const key = `${choreId}:${selectedDate}`
  if (pendingRef.current.has(key)) return   // already in flight
  pendingRef.current.add(key)

  const optimistic: ChoreCompletion = {
    id: `optimistic-${key}`,
    chore_id: choreId,
    completed_by: userId,
    completed_at: new Date().toISOString(),
    for_date: selectedDate,
  }
  setCompletions(prev => [...prev, optimistic])

  let error: Error | null = null
  try {
    const result = await supabase.from('chore_completions').insert({
      chore_id: choreId,
      completed_by: userId,
      for_date: selectedDate,
    })
    error = result.error
  } finally {
    pendingRef.current.delete(key)   // always unblock, even on unexpected throw
  }

  if (error) {
    setCompletions(prev => prev.filter(c => c.id !== optimistic.id))
  }
}
```

`useRef` is used (not `useState`) so the guard doesn't cause a re-render.

### Problem B — RLS allows cross-house completion insert
The current completion insert RLS (`rls.sql:~60`) only checks `completed_by = auth.uid()`. It does not verify the chore belongs to the user's house. A user who knows a valid `chore_id` from another house could insert a completion for it.

**Fix:** Add a `with check` that joins through `chores`:

```sql
-- Migration: tighten completions insert policy
drop policy if exists "completions: insert own" on public.chore_completions;
create policy "completions: insert own"
  on public.chore_completions for insert
  with check (
    completed_by = auth.uid()
    and chore_id in (
      select id from public.chores where house_id = public.my_house_id()
    )
  );
```

Add to `supabase/migrations/20260625000002_tighten_completion_rls.sql`.

---

## Task 6 — Delete Dead Edge Function (`notify-assigned`)

**Severity:** Low  
**Files:** `supabase/functions/notify-assigned/`

### Problem
`supabase/functions/notify-assigned/` contains an `index.ts` that is never triggered — no database trigger, no cron schedule, no deploy manifest references it. It predates the current notification architecture and would send stale push messages if accidentally deployed.

The legacy theme aliases in `constants/theme.ts` (`gradientStart`, `textPrimary`, `cardBackground`, `mutedSurface`, etc.) are **not** dead. They have active callers across at least six files (`app/(auth)/sign-in.tsx`, `app/(auth)/onboarding.tsx`, `app/no-house.tsx`, `app/join/[code].tsx`, `components/house/MemberList.tsx`, `components/house/InviteSection.tsx`, `components/ui/PillBadge.tsx`). Deleting them without migrating callers would break TypeScript compilation. Leave them in place — a full alias-to-token migration is a separate cleanup pass, not a correctness fix.

### Fix
Delete `supabase/functions/notify-assigned/` entirely. If push-on-assignment is needed in a future phase, it should be designed as a Postgres trigger + edge function with proper RLS and test coverage.

No app code changes. No schema changes.

---

## Task 7 — Elevate `useHouse` to Context (Architecture, Separate PR)

> **Note:** This task has more blast radius than Tasks 1–6. It touches the root layout and every screen that consumes house state. It should be implemented and reviewed as an isolated commit/PR after the correctness fixes in Tasks 1–6 land and are verified.

**Severity:** Medium (architecture)  
**Files:** `context/HouseContext.tsx` (new), `app/_layout.tsx`, all screens

### Problem
`useHouse` is called independently in three places: `app/_layout.tsx`, `app/(app)/index.tsx`, and `app/(app)/house.tsx`. Each call fires its own Supabase query and maintains its own local state. The root layout already calls `useHouse` for routing — the two screen-level calls are redundant fetches. There is no single source of truth for house state.

### Fix
Create `context/HouseContext.tsx` mirroring the `AuthProvider` pattern already used for auth:

```ts
interface HouseState {
  house: House | null
  members: HouseMember[]
  loading: boolean
  createHouse: (name: string) => Promise<{ error: string | null }>
  joinHouse: (code: string) => Promise<{ error: string | null }>
  leaveHouse: () => Promise<{ error: string | null }>
  refetch: () => Promise<void>
}

export function HouseProvider({ userId, children }: { userId: string | undefined; children: ReactNode }) { ... }
export function useHouseContext() { return useContext(HouseContext) }
```

Mount it in `app/_layout.tsx` inside `AuthProvider` (so `userId` is available). All three existing `useHouse(session?.user.id)` call sites become `useHouseContext()` — one query, shared state, no prop drilling.

`useHouse.ts` is not deleted — it becomes the internal implementation called once by `HouseProvider`. All its logic stays the same.

---

## Implementation Order

| # | Task | Risk | Schema change | Test change |
|---|------|------|--------------|-------------|
| 1 | `todayLocalISO` + overdue fix | Low | None | Add timezone tests |
| 2 | Scope completion fetch | Low | None | Update chores tests |
| 3 | Fix subscriptions + channel names | Low | None | None |
| 4 | `join_house_by_code` race fix | Low | New migration | None (RPC-level) |
| 5 | `markDone` guard + completion RLS | Low | New migration | Add markDone tests |
| 6 | Dead code removal | None | None | Verify with `rg` |
| 7 | `HouseContext` | Medium | None | None |

Tasks 1–6 are independent. Task 7 touches the most files and should go last. Tasks 4 and 5 each require a migration to be deployed to Supabase before the fix is active.

---

## Out of Scope for This Round

- Supabase type generation (`supabase gen types typescript`) — correct approach but requires a connected Supabase project and a separate decision about where generated types live.
- `AddChoreSheet` daily chore edit bug — edge case, deferred to a UX polish pass.
- Formal RLS integration tests — requires a local Supabase instance; tracked separately.
