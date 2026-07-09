> **SUPERSEDED** — Pre-dates the current roles/store gamification direction. Issues tracked here have since been resolved. Kept for historical reference.

# App Readiness Design Document

**Goal:** Identify and resolve everything blocking (a) Phase 2 gamification schema work and (b) public App Store submission. No implementation until approved.

---

## Track ordering note

The "after gamification" label on Track 2 assumes gamification ships first. If the goal is App Store / TestFlight submission soon, flip the order: do Track 2 before gamification, not after. The two tracks are independent and either can go first.

---

## Track 1 — Pre-Gamification (do first)

These must be resolved before writing gamification schema or triggers.

---

### 1A — Supabase CLI state cleanup

**Problem 1: `supabase/.temp/` is not gitignored**

`supabase/.temp/` contains local CLI state: linked project ref, API version snapshots, pooler URL. This is machine-specific runtime cache — not config. Committing it breaks fresh clones on other machines and causes `supabase link` to behave unpredictably.

**Fix:** Add `supabase/.temp/` to `.gitignore`.

**Problem 2: `supabase/config.toml` is modified but not committed**

The diff removes the `[project]` section header and the placeholder comment, leaving only `project_id = "tidy"`. This change is **functional, not cosmetic**: in TOML, `[project]` declares a table — it puts `project_id` under the `project` namespace rather than at the top level. The current Supabase CLI expects `project_id` at the top level; the old `[project]` header caused `supabase link` to fail to parse the project ID. The corrected file (without the header) is what the CLI requires, and it must be committed so all contributors get a working config.

**Fix:** Commit the cleaned-up `config.toml` along with the `.gitignore` update.

---

### 1B — Gamification design decisions (blocking schema)

These four questions directly affect table shape, trigger logic, and indexes. All four must be decided before implementation.

---

**Question 1: How do points work across complete → undo → complete?**

**Previous proposals (both rejected):**
- `UNIQUE(chore_id, for_date, event_type)` — broken because a reversal row does not free the slot; a re-complete would be blocked.
- `AFTER DELETE on chore_completions` trigger — broken because `chore_completions` rows are also deleted by cascades (deleting a chore cascades its completions; deleting a user cascades their completions). A blind DELETE trigger would subtract historical points whenever a chore is removed, which is wrong. This interacts directly with the recent `deleteChore` cleanup that now relies on `ON DELETE CASCADE`.

**Corrected decision: Explicit RPC for undo. No DELETE trigger on `chore_completions`.**

Points are awarded by a trigger on INSERT (existing). Points are reversed by an explicit RPC `undo_chore_completion()` that performs the delete and writes the reversal atomically in the same transaction. Cascade deletes — from chore deletion, user deletion, or any future admin operation — never trigger reversals.

**How it works:**

- **Award trigger — `AFTER INSERT on chore_completions`:** Inserts `+10` (or `+15` if overdue) into `score_ledger`. Existing design, add `for_date`.
- **No DELETE trigger.** Cascade deletes are silent with respect to scoring.
- **RPC `undo_chore_completion(p_chore_id, p_for_date)`:** Called by the client's `undoMarkDone`. Deletes the completion row and inserts a `−10` (or `−15`) reversal row in a single transaction. The RPC verifies the caller owns the completion before proceeding.

**Flow:**

| Action | Mechanism | `score_ledger` insert | Net `house_scores` |
|--------|-----------|----------------------|-------------------|
| Mark done | INSERT trigger | +10 | +10 |
| Undo | RPC: delete + reversal insert | −10 | 0 |
| Mark done again | INSERT trigger | +10 | +10 |

**Why no duplicate-points risk:** `chore_completions` has `UNIQUE(chore_id, for_date)`. A network retry that double-fires the INSERT is blocked at the completion level before the award trigger can run. The RPC is also idempotent — if the completion row is already gone, it returns early.

**RPC:**

```sql
create or replace function public.undo_chore_completion(
  p_chore_id uuid,
  p_for_date date
)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v_completion_id uuid;
  v_completed_by  uuid;
  v_house_id      uuid;
  v_due_date      date;
  v_points        integer := -10;
begin
  -- Find the completion row and verify caller owns it
  select id, completed_by
  into v_completion_id, v_completed_by
  from public.chore_completions
  where chore_id = p_chore_id and for_date = p_for_date
  for update;

  if not found then return; end if;  -- already undone, idempotent

  if v_completed_by != auth.uid() then
    raise exception 'cannot undo another user''s completion';
  end if;

  select house_id, due_date into v_house_id, v_due_date
  from public.chores where id = p_chore_id;

  -- Mirror the overdue bonus if it applied
  if v_due_date is not null and p_for_date > v_due_date then
    v_points := -15;
  end if;

  -- Delete the completion — no score trigger fires here
  delete from public.chore_completions where id = v_completion_id;

  -- Write the reversal explicitly in the same transaction
  insert into public.score_ledger (user_id, house_id, event_type, points, chore_id, for_date)
  values (v_completed_by, v_house_id, 'chore_completion_reversal', v_points, p_chore_id, p_for_date);
end;
$$;
```

**Client change (hooks/useChores.ts):** `undoMarkDone` calls this RPC instead of the direct Supabase delete:

```ts
const result = await supabase.rpc('undo_chore_completion', {
  p_chore_id: choreId,
  p_for_date: selectedDate,
})
```

The optimistic update logic in the client stays the same — it still removes the completion from local state immediately and restores it if the RPC fails.

**`score_ledger` schema — corrected to include `for_date`:**

```sql
create table public.score_ledger (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  house_id     uuid not null references public.houses(id) on delete cascade,
  event_type   text not null,  -- 'chore_completion' | 'chore_completion_reversal' | 'streak_bonus'
  points       integer not null,
  chore_id     uuid references public.chores(id) on delete set null,
  for_date     date not null,
  created_at   timestamptz not null default now()
);
create index on public.score_ledger(user_id, house_id);
create index on public.score_ledger(for_date);
```

**`award_completion_points()` — add `for_date` to the insert:**

```sql
insert into public.score_ledger (user_id, house_id, event_type, points, chore_id, for_date)
values (NEW.completed_by, v_house_id, 'chore_completion', v_points, NEW.chore_id, NEW.for_date);
```

Both `award_completion_points()` and `undo_chore_completion()` must include `set search_path = public` per the existing `join_house_by_code` function pattern.

---

**Question 2: Do scores reset (weekly / monthly / seasonally)?**

**Decision: Cumulative, no automatic reset.**

`house_scores` is all-time total. The leaderboard shows all-time rank by default. Time-windowed views ("this week") are query-time filters on `score_ledger.for_date`, not resets. This keeps the ledger as the authoritative source and avoids destructive scheduled operations.

---

**Question 3: Do zero-chore days maintain a streak?**

**Decision: Zero-chore days are neutral — streak is neither incremented nor broken.**

The `evaluate-streaks` Edge Function skips users who have no assigned chores active on a given day. This is the fairest behavior: a user who has no chores scheduled on a Sunday is not punished. The streak counter only advances or resets on days where the user had at least one obligation.

---

**Question 4: Is the leaderboard house-only or global?**

**Decision: House-only.**

The product's mental model is a roommate group. A global leaderboard across strangers has no social value in v1 and creates data exposure questions. `house_scores` is indexed by `(house_id, score desc)` for this query pattern. Global leaderboard is out of scope.

---

### 1C — Real-device smoke test (required before gamification build)

Automated tests pass but do not exercise the full user journey on device. Run each flow on a physical iOS device with a fresh install before starting Phase 2 implementation.

| Flow | Steps | Pass criteria |
|------|-------|---------------|
| Sign up | Install → Apple Sign In → onboarding name + photo → Continue | Lands on no-house screen |
| Create house | Tap Create → enter name → confirm | Lands on home screen, house name visible |
| Invite link | Share link → open on second device → sign in → join | Second user sees same house |
| Add chore | Chores tab → + Add → fill form → Save | Chore appears in list |
| Edit chore | Tap chore → edit name → Save changes | Chore name updated |
| Delete chore | Long-press or edit → Delete | Chore removed from list |
| Mark done | Tap checkbox | Optimistic check, syncs to DB |
| Undo mark done | Tap filled checkbox | Undoes immediately, syncs to DB |
| Push permission | Join house → permission prompt appears → Allow | `push_token` saved to profiles row |
| Leave house | House tab → Leave house → confirm | Returns to no-house screen |
| Cold restart | Kill app → reopen | Lands on home screen (not sign-in) |

---

## Track 2 — Release Readiness (App Store blockers)

These are required before any public App Store submission.

---

### 2A — Account deletion (Apple hard requirement)

**Source:** Apple App Store Review Guideline 5.1.1(v) — apps that support account creation must let users initiate account deletion in-app.

**Current state:** No deletion flow exists. The app has sign-up, profile creation, and house membership — all Apple-flagged surfaces.

**Architecture:**

1. **Edge Function `delete-account`** — called from the client with the user's JWT. Uses `SUPABASE_SERVICE_ROLE_KEY` (automatically injected into Edge Functions). Verifies the JWT matches the account being deleted, then calls `supabase.auth.admin.deleteUser(userId)`.
   - The cascade `auth.users → profiles → house_members` cleans up all user data automatically.
   - `chores.assigned_to` has `ON DELETE SET NULL` — orphaned chore assignments become unassigned.
   - File: `supabase/functions/delete-account/index.ts`

2. **In-app confirmation UI** — accessible from the House screen settings section, below "Leave house." Two-step: first tap shows a confirmation Alert ("This will permanently delete your account and all your data."); confirming calls the Edge Function then signs the user out locally.
   - Add to `app/(app)/house.tsx`

**Data deleted:** `auth.users` row + all cascaded rows (profiles, house_members, chore_completions). Houses and chores themselves are not deleted — they belong to the house, not the departing user.

---

### 2B — App icon, splash, and missing notification asset

**Current state:** `app.json` declares no `icon` or `splash` fields. App Store submission requires both. Additionally, `app.json` references `./assets/notification-icon.png` at line 46, but **that file does not exist** — this crashes an EAS production build before it starts.

**Assets that exist:** `assets/icon.png`, `assets/splash-icon.png`

**Fix — `app.json` additions:**
```json
"icon": "./assets/icon.png",
"splash": {
  "image": "./assets/splash-icon.png",
  "resizeMode": "contain",
  "backgroundColor": "#fff8f4"
},
```

The `ios` block does not need a separate `icon` field — the top-level `icon` applies to iOS automatically unless overridden.

**Fix — notification icon (Android concern):**

The `expo-notifications` plugin accepts a notification icon primarily for **Android** — it sets the small icon shown in the Android status bar, which must be white-on-transparent per Android design guidelines. iOS does not use this field in the same way; the iOS notification appearance is controlled by the app icon and system behavior.

Options:
- Create a 96×96 white-on-transparent PNG (white ✦ glyph) and save as `assets/notification-icon.png` — correct for Android
- Or remove the `icon` option from the `expo-notifications` plugin entry in `app.json` to unblock builds immediately (iOS is unaffected; Android will use a default)

Recommendation: create the proper white-on-transparent asset before launch. For now, remove the `icon` option to unblock EAS builds.

---

### 2C — EAS build configuration

**Current state:** No `eas.json` exists. EAS Build is required for production iOS builds (TestFlight, App Store).

**Fix — create `eas.json`:**
```json
{
  "cli": {
    "version": ">= 16.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "alexjchen@berkeley.edu",
        "ascAppId": "FILL_IN_APP_STORE_CONNECT_ID",
        "appleTeamId": "FILL_IN_APPLE_TEAM_ID"
      }
    }
  }
}
```

**Required follow-up (human steps, not code):**
1. Run `eas build:configure` to link the project
2. Set `ascAppId` from App Store Connect after creating the app record
3. Set `appleTeamId` from your Apple Developer account

---

### 2D — Privacy policy and support URLs

**Current state:** No privacy policy exists. App Store Connect requires a privacy policy URL for any app using sign-in, user data, or push notifications. Tidy collects: name, photo, household data, push tokens, device timezone.

**Required:**
- Host a privacy policy at a public URL (e.g., `tidy.app/privacy`)
- Host a support page or link (e.g., `tidy.app/support` or a GitHub Issues link)
- Enter both URLs in App Store Connect before submission

**Content must cover:** auth provider data (Apple/Google), profile data stored in Supabase, push notification tokens, photo uploads to Supabase Storage, data deletion (link to the in-app deletion flow from 2A).

This is a legal/content task, not a code task. Document as a manual checklist item.

---

### 2E — Universal links (AASA file)

**Current state:** `app.json` declares `"associatedDomains": ["applinks:tidy.app"]`. This config is correct, but the domain must serve a valid `apple-app-site-association` file for universal links to work in production.

**Required:** Host at `https://tidy.app/.well-known/apple-app-site-association`:
```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "APPLE_TEAM_ID.com.tidy.app",
        "paths": ["/join/*"]
      }
    ]
  }
}
```

Replace `APPLE_TEAM_ID` once known. The file must be served with `Content-Type: application/json` — no redirect, no auth.

**Without this:** Invite links (`tidy.app/join/CODE`) fall back to the browser instead of opening the app. The entire invite flow breaks in production.

---

### 2F — Production auth configuration

**Required Supabase dashboard changes before TestFlight:**

1. **Redirect URLs:** Add `tidy://auth/callback` to the allowed redirect URLs list in Supabase → Authentication → URL Configuration.
2. **Apple Sign In:** Confirm the Apple Sign In service ID and redirect URL match production bundle `com.tidy.app`.
3. **Google OAuth:** Confirm the Google OAuth redirect URL matches the production bundle.

Dashboard configuration steps — not code.

---

### 2G — Production push notifications

**Required before TestFlight:**

1. Generate an APNs Auth Key (.p8) in Apple Developer → Certificates, Identifiers & Profiles → Keys → Apple Push Notifications service (APNs).
2. Upload to Expo: `eas credentials` → iOS → Push Notifications → Add, or via the Expo web dashboard.

**Verify:** Install via TestFlight → allow notification permission → trigger a chore assignment → confirm push arrives on device.

---

## Implementation order

Two valid orderings depending on priority:

**If gamification ships first:**
```
Track 1A  →  Supabase CLI cleanup            1 commit
Track 1B  →  Gamification decisions          Approve this doc
Track 1C  →  Real-device smoke test          Manual, on device
Phase 2   →  Gamification schema + hooks     Separate plan (Part B)
Track 2   →  Release readiness pass          Before App Store submit
```

**If App Store / TestFlight is the priority:**
```
Track 1A  →  Supabase CLI cleanup            1 commit
Track 1C  →  Real-device smoke test          Manual, on device
Track 2   →  Release readiness pass          Before App Store submit
Phase 2   →  Gamification                    After launch
```

---

## What is NOT a blocker

- TypeScript is clean, tests pass, `expo export --platform ios` builds succeed
- RLS is deployed and tightened (migration pushed)
- Expo SDK 56 meets current iOS 16.4+ requirement
- `supabase/.temp/` is local CLI cache — safe to ignore
