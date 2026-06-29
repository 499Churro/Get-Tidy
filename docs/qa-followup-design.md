# QA Follow-up Fixes — Design Document

**Goal:** Close the four remaining issues flagged after the MVP bug-fix pass. No changes until this document is approved.

---

## Issue 1 — mark/undo race (shared lock key) — High

**File:** `hooks/useChores.ts`

### Problem

`markDone` locks with key `${choreId}:${selectedDate}`.  
`undoMarkDone` locks with key `undo:${choreId}:${selectedDate}`.

These are different keys, so `pendingRef` does not block them from running concurrently. The race:

1. User taps **Done** → `markDone` starts, optimistic completion added, INSERT in flight.
2. User taps **Undo** immediately → `undoMarkDone` starts (different key, not blocked), snapshot taken, optimistic completion removed, DELETE sent.
3. DELETE arrives at Supabase first — no row exists yet, silently succeeds (or fails with 404 if the row check is strict).
4. INSERT arrives and succeeds — row now exists, but the UI has already removed the optimistic entry. Chore appears incomplete in the UI while the DB says it is complete.

The inverse race (undo-then-mark) is equally problematic.

### Fix

Use **one shared key per `choreId:date`** for both directions. `undoMarkDone` checks the same key `${choreId}:${selectedDate}`. If a mark is in flight, the undo tap returns early; if an undo is in flight, another undo tap returns early. Neither direction needs its own key prefix.

```ts
// markDone — unchanged key
const key = `${choreId}:${selectedDate}`
if (pendingRef.current.has(key)) return
pendingRef.current.add(key)
// ... insert ...
// finally: pendingRef.current.delete(key)

// undoMarkDone — SAME key, no "undo:" prefix
const key = `${choreId}:${selectedDate}`
if (pendingRef.current.has(key)) return
pendingRef.current.add(key)
// ... delete ...
// finally: pendingRef.current.delete(key)
```

One line change: remove `undo:` prefix from the key in `undoMarkDone`.

---

## Issue 2 — Exception path skips rollback — High

**File:** `hooks/useChores.ts` (lines ~78 and ~108)

### Problem

The current pattern:

```ts
let error: { message: string } | null = null
try {
  const result = await supabase.from(...).insert(...)
  error = result.error          // only reached if no throw
} finally {
  pendingRef.current.delete(key)
}
if (error) {                    // never reached if the try threw
  setCompletions(prev => ...)   // ROLLBACK
}
```

If the `await` throws (network offline, Supabase SDK throws, timeout), JS runs `finally` (clearing pending) and then **re-throws the exception**. The function exits early — `if (error)` is never reached at all. Rollback is skipped. The optimistic UI entry is stuck.

Same problem exists in `undoMarkDone`: if the delete throws, the snapshot is never restored.

### Fix

Move rollback into `catch` as well:

```ts
// markDone
let succeeded = false
try {
  const result = await supabase.from('chore_completions').insert({ ... })
  if (!result.error) succeeded = true
} catch {
  // network/SDK throw — treat as failure
} finally {
  pendingRef.current.delete(key)
}
if (!succeeded) {
  setCompletions(prev => prev.filter(c => c.id !== optimistic.id))
}

// undoMarkDone
let succeeded = false
try {
  const result = await supabase.from('chore_completions').delete()...
  if (!result.error) succeeded = true
} catch {
  // network/SDK throw
} finally {
  pendingRef.current.delete(key)
}
if (!succeeded) {
  setCompletions(prev => [...prev, ...snapshot])
}
```

`succeeded` is `false` by default, so any path that doesn't explicitly set it to `true` (returned error, thrown exception, or anything else) rolls back the optimistic state.

---

## Issue 3 — pendingInvite in-memory only — Medium

**File:** `lib/pendingInvite.ts`, `app/no-house.tsx`

### Problem

`pendingCode` is a module-level JS variable. It survives normal in-app navigation (React Navigation keeps the JS runtime alive), but is lost in:

- **OAuth/social redirects**: Google/Apple sign-in opens Safari or a system sheet. On some OS versions this triggers a cold start when returning to the app.
- **App backgrounded and killed**: OS terminates the process; module variable gone.
- **Expo dev double-render**: Fast Refresh can reinitialize modules.
- **React strict mode double-invoke**: `consumePendingInviteCode()` runs twice during dev; second call gets `null` and initial state is wrong.

The double-render issue is particularly sharp: `consumePendingInviteCode()` is called directly in the render body of `no-house.tsx` (line 17). In React strict mode (dev) the component renders twice — the second render gets `null`.

### Fix

Two parts:

**A — Persist with AsyncStorage**

Replace the in-memory variable with AsyncStorage so the code survives redirects and cold starts:

```ts
// lib/pendingInvite.ts
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'tidy:pending_invite_code'

export async function setPendingInviteCode(code: string): Promise<void> {
  await AsyncStorage.setItem(KEY, code)
}

export async function consumePendingInviteCode(): Promise<string | null> {
  const code = await AsyncStorage.getItem(KEY)
  if (code) await AsyncStorage.removeItem(KEY)
  return code
}
```

**B — Move consume out of render**

`no-house.tsx` must not call an async function in the render body. Move the consume into a `useEffect` that fires once on mount, and initialize state asynchronously:

```ts
const { code: prefillCode } = useLocalSearchParams<{ code?: string }>()
const [code, setCode] = useState(prefillCode ?? '')
const [tab, setTab] = useState<'create' | 'join'>(prefillCode ? 'join' : 'create')

useEffect(() => {
  if (prefillCode) return           // route param takes precedence, nothing to do
  consumePendingInviteCode().then(pending => {
    if (pending) {
      setCode(pending)
      setTab('join')
    }
  })
}, [])                              // run once on mount
```

**Callers to update:**

- `app/join/[code].tsx`: `setPendingInviteCode` is now async. Call it inside an inner async function within the `useEffect` — do **not** make the effect callback itself async. `router.replace` must not run until the write completes:
  ```ts
  useEffect(() => {
    if (loading) return
    if (!session) {
      if (code) {
        // Inner async to keep effect callback synchronous
        ;(async () => {
          await setPendingInviteCode(code)
          router.replace('/(auth)/sign-in')
        })()
      } else {
        router.replace('/(auth)/sign-in')
      }
    } else {
      router.replace({ pathname: '/no-house', params: { code } })
    }
  }, [session, loading, code])
  ```
- `app/no-house.tsx`: replace the inline render-body `consumePendingInviteCode()` call with the `useEffect` pattern shown above.

`@react-native-async-storage/async-storage` is already a standard Expo dependency (bundled with `expo` SDK 56). No new package install needed — confirm with `grep "async-storage" package.json`.

---

## Issue 4 — Onboarding avatar upload uncaught — Medium

**File:** `app/(auth)/onboarding.tsx`

### Problem

The avatar upload block (lines 41–54) runs `fetch(avatarUri)`, `.blob()`, and `supabase.storage.upload()` without a try/catch. If any of these throw (network error, permission denied, malformed URI), the exception propagates out of `handleSave`, skips `setLoading(false)`, and leaves the button stuck on "Saving…". The user cannot retry without restarting the screen.

The `setLoading(false)` at line 64 is only reached after the entire block completes cleanly.

### Fix

Wrap the entire `handleSave` body in a `try/finally` so `setLoading(false)` always runs:

```ts
async function handleSave() {
  if (!displayName.trim()) {
    Alert.alert('Name required', 'Please enter a display name.')
    return
  }
  setLoading(true)
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const colorIndex = user.id.charCodeAt(0) % AvatarGradients.length
    const timezone =
      getCalendars()[0]?.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'UTC'

    let avatar_url: string | null = null
    if (avatarUri) {
      try {
        const ext = avatarUri.split('.').pop() ?? 'jpg'
        const path = `${user.id}/avatar.${ext}`
        const response = await fetch(avatarUri)
        const blob = await response.blob()
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, blob, { upsert: true })
        if (!uploadError) {
          const { data } = supabase.storage.from('avatars').getPublicUrl(path)
          avatar_url = data.publicUrl
        }
      } catch {
        // Avatar upload failed — continue with no avatar rather than blocking onboarding
      }
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      display_name: displayName.trim(),
      avatar_url,
      avatar_color_index: colorIndex,
      timezone,
    })

    if (error) { Alert.alert('Error', error.message); return }
    await refreshProfile()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Something went wrong.'
    Alert.alert('Error', msg)
  } finally {
    setLoading(false)
  }
}
```

Two intentional decisions:
- Avatar upload failure is swallowed with a silent `catch` (inner). The user gets a profile without a photo, which is better than being stuck. A future enhancement could show a non-blocking warning.
- Profile upsert failure is surfaced with `Alert.alert`. This is a hard blocker — no profile, no app — so the user needs to know.

---

## Implementation Order

| # | Issue | Severity | Files | Risk |
|---|-------|----------|-------|------|
| 1 | Shared lock key for mark/undo race | High | `hooks/useChores.ts` | Low — one-line key change |
| 2 | Exception rollback in mark/undo | High | `hooks/useChores.ts` | Low — restructure try/catch pattern |
| 3 | AsyncStorage for pending invite | Medium | `lib/pendingInvite.ts`, `app/join/[code].tsx`, `app/no-house.tsx` | Medium — async API change, three files |
| 4 | Onboarding try/finally | Medium | `app/(auth)/onboarding.tsx` | Low — wraps existing logic |

Issues 1 and 2 are in the same file and can be implemented together in one commit. Issues 3 and 4 are independent and can be separate commits.

No schema changes. No new packages. No migrations.
