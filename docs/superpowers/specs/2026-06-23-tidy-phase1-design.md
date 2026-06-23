# Tidy — Phase 1 Design Spec

**Date:** 2026-06-23  
**Scope:** Phase 1 — Lean Core (utility layer, no gamification)  
**Stack:** Expo (React Native) + Supabase  
**Platforms:** iOS (primary), Web (accessible)  
**Product name:** Tidy (final — used consistently throughout)

---

## 1. What We're Building

A mobile-first chore management app for college roommates. Phase 1 ships the core utility loop: create a house, invite roommates, assign chores, mark them done, get notified. No rotation logic, no gamification — just the foundation that makes the app useful on day one.

---

## 2. Authentication

- **Primary:** Apple Sign-In, Google Sign-In (one tap, no password)
- **Fallback:** Email + password (for web and non-Apple/Google users)
- Supabase Auth handles all providers
- On first sign-in, user completes a one-time setup: display name (required) and profile photo (optional)
- **Fallback avatar:** If no photo is set, the avatar renders the user's initials on their assigned avatar color (see Section 7)
- **Timezone:** Device timezone is captured on first sign-in and stored on the user record. Used for notification scheduling.

---

## 3. House Creation & Joining

### Data Model

```
houses
  id, name, created_by, created_at, code (unique 8-char alphanumeric)

house_members
  id, house_id, user_id, joined_at
  UNIQUE(user_id)   -- Phase 1: one house per user, enforced at DB level
```

### Rules
- Any signed-in user can create a house. They become the first member automatically.
- **One house per user (Phase 1):** The `UNIQUE(user_id)` constraint on `house_members` prevents a user from being in two houses simultaneously. Enforced server-side via Supabase RLS; not just on the client. If a user attempts to join a second house, the client shows: *"You're already in a house. Leave your current house first to join another."*
- **Leaving a house:** The user's row is removed from `house_members`. Their assigned chores become unassigned (the `assigned_to` field is set to null). Chores are not deleted.
- **Rejoining:** A user who has left a house may rejoin using the same house code. This creates a new `house_members` row, which is valid because the previous row was deleted on leave.

### Joining

Both entry points use the same underlying mechanism: an 8-character alphanumeric house code (e.g. `TIDY-4B2K`).

- **Manual entry:** User taps "Join house" and types the code.
- **Invite link:** The code is embedded in a deep link — `tidy.app/join/TIDY-4B2K`.
  - If Tidy is installed: the link opens the app directly with the code pre-filled. If the user is already signed in, they confirm and join immediately. If not signed in, they authenticate first and then join.
  - If Tidy is not installed: the link opens the web fallback, which prompts download (iOS) or allows sign-in on web with the code pre-filled in the join form.

### Permissions

Every house member has equal rights: any member can create, edit, or delete any chore in the house. There are no admin or owner roles.

---

## 4. Chore Data Model

```
chores
  id
  house_id          (required, FK → houses)
  created_by        (required, FK → users — audit only, no special permissions)
  name              (required, text)
  assigned_to       (optional, FK → users — null = unassigned)
  due_date          (optional, date only — no time component)
  notes             (optional, text)
  frequency         (required, enum: 'daily' | 'weekly')

chore_completions
  id
  chore_id          (required, FK → chores)
  completed_by      (required, FK → users)
  completed_at      (required, timestamp)
  for_date          (required, date — the calendar day this completion counts for)
```

**Why a separate completions table:** A daily chore needs to be marked done once per day. A single `completed_at` on the chore would make it permanently complete after the first time. The system checks "does a completion record exist for this chore + for_date?" to determine if a chore is done on any given day.

### What `frequency` controls

**Daily chores:**
- Appear in the chore list for every day of the week strip.
- Must be completed once per day. A completion on Monday does not satisfy Tuesday.

**Weekly chores:**
- If `due_date` is set: the chore appears **only on that specific day** of the week strip.
- If `due_date` is not set: the chore appears on **Monday of the current week** as a weekly catch-all — it is treated as "due this week, day unspecified." It remains visible on Monday until completed for that week.
- A weekly chore needs one completion per week. Completing it on any day satisfies the week (the `for_date` on the completion record captures the actual day it was done).

The frequency label (`Daily` / `Weekly`) is shown as a secondary label on each chore card.

### Unassigned chores

- Appear **only** in the default "all chores" list view (when no avatar is selected).
- Do **not** appear when an avatar filter is active — they are excluded from individual roommate views entirely.
- Do **not** count toward any avatar's completion metrics (`2/3` count).
- Do **not** count toward the progress dot house-completion calculation.
- Displayed without an assignee label.

---

## 5. Push Notifications

Delivered via Supabase Edge Functions + Expo Push Notification Service (EPNS).

| Trigger | When it fires | Scope |
|---|---|---|
| Chore assigned to you | Immediately when `assigned_to` is set to you | Assigned chores only |
| Chore due today | 8am in user's stored timezone, on the `due_date` | Assigned chores only |
| Chore overdue | 8am in user's stored timezone, morning after `due_date` if no completion exists for that `for_date` | Assigned chores only |

**Rules:**
- Due-today and overdue notifications apply **only to chores with an `assigned_to`**. Unassigned chores never trigger notifications.
- The overdue notification fires once only — the morning after the due date.
- Completing a chore before the overdue notification fires cancels it.
- Completing an overdue chore after the notification has already fired does not re-trigger or suppress it.

**Permission prompt:** Shown immediately after the user successfully joins or creates a house. Copy: *"Get reminded when your chores are due."* Not shown at sign-up.

**Enabling later:** If the user dismisses the permission prompt, they can enable notifications at any time from the House screen (Settings section) or from their device's native app settings.

---

## 6. Navigation Structure

**Bottom tab bar — 2 tabs:** `Chores` (default) | `House`

### Chores Screen (top to bottom)

#### Header
Tidy logo (gradient square + ✦ star) + wordmark "tidy" left-aligned. House name pill right-aligned.

#### Week Strip
- Shows Mon–Sun of the current calendar week. Resets on Monday.
- Today is highlighted with the primary gradient; all other days use the muted surface color.
- Tapping a day updates the chore list and hero card to show that day's chores.
- Default on open: today.
- Each day shows a **progress dot** reflecting **whole-house** completion for that day:
  - 🔴 Red — 0% of house chores complete
  - 🟠 Orange — ~25% complete
  - 🟡 Yellow — 50%+ complete
  - 🟢 Green — 100% complete
  - No dot — no chores scheduled for that day
- **Dot calculation:** Uses only chores scheduled for that specific day (daily chores + weekly chores with a matching `due_date`, and weekly chores without a `due_date` on Monday only). Unassigned chores are **excluded** from the calculation.
- The dot legend does **not** appear on this screen. It is shown once during onboarding.

#### Avatar Row
- Horizontal strip of all house members, including the current user ("You").
- Each avatar shows: profile photo (or initials fallback), name, completion count for the selected day (e.g. `2/3`). Unassigned chores are excluded from these counts.
- Tapping an avatar filters the hero card and chore list to show **only that person's assigned chores**. Unassigned chores are not shown in this filtered view.
- The selected avatar gets a colored ring. Tapping the current user's own avatar (or tapping the already-selected avatar) deselects and returns to the default all-chores view.
- Completion count label colors: green if fully complete (`3/3 ✓`), red if zero (`0/2`), orange otherwise.

#### Hero Card
- Shows the **first incomplete chore** for the selected person + day, sorted by `due_date` ascending then `created_at` ascending as tiebreaker.
- **If viewing yourself:** coral-to-amber gradient. CTA: "Mark as done ✓".
- **If viewing a roommate:** that person's avatar color gradient. CTA is read-only: "Not done yet" — you cannot mark it done for them.
- **If all chores are complete for that day:** hero card renders a completion state — *"All done for today! ✦"* on a muted surface background. Same card dimensions, no layout collapse.
- **If no chores are assigned for that day (including when no avatar selected and no unassigned chores exist):** hero card renders an empty state — *"[Name] has nothing today."* on a muted surface background. Same card dimensions, no layout collapse.

#### Chore List
- Shows chores for the selected day and selected person, or all house chores (assigned + unassigned) when no avatar is selected.
- Each chore card: circular checkbox + name + frequency label + assignee name (or blank if unassigned) + due status.
- **Overdue:** red left border, red secondary text.
- **Completed:** checkbox filled with gradient, name struck through, card dimmed (opacity 0.5).
- List order: incomplete first (sorted by `due_date` asc then `created_at` asc), completed appended at bottom.
- `+ Add` button in the section header.

### House Screen
- Member list with profile photos and display names
- Invite section: shows house code in large text + "Share invite link" button
- Notification settings: "Enable reminders" toggle (links to device notification settings if permission was previously denied)
- Leave house option (with confirmation dialog)

---

## 7. Visual Design

### Color Palette
| Token | Value | Usage |
|---|---|---|
| Background | `#fff8f4` | Screen background |
| Primary gradient start | `#ff7c5c` | Coral |
| Primary gradient end | `#ffb347` | Amber |
| Overdue | `#ef4444` | Red |
| Complete | `#22c55e` | Green |
| Text primary | `#1a1a1a` | |
| Text secondary | `#92786a` | |
| Card background | `#ffffff` | |
| Muted surface | `#f0ebe7` | Avatars, pills |

### Avatar Colors
On account creation, each user is assigned one of 8 curated gradients (coral, green, purple, amber, blue, pink, teal, olive). The assigned color is used for: fallback avatar background, selected ring, and hero card gradient when viewing that person. User-selectable avatar color is out of scope for Phase 1.

### Logo
Gradient square (`border-radius: 9px`, coral-to-amber gradient) containing a ✦ star glyph in white. Followed by wordmark "tidy" in font-weight 800, `#1a1a1a`. Product name is **Tidy** (capitalised in prose, lowercase in the wordmark).

### Cards
`border-radius: 14px`, white background, `box-shadow: 0 2px 8px rgba(0,0,0,0.05)`.

### Bottom Nav
Floating pill, white background, `border-radius: 18px`, shadow. Tabs: icon + label. Active tab label uses primary coral color.

### Typography
System font (`-apple-system`, `system-ui`). No custom font in Phase 1.

---

## 8. Key Interactions

| Interaction | Behavior |
|---|---|
| Mark chore done | Tap circular checkbox. Optimistic update immediately; Supabase write in background. Inserts a row into `chore_completions` with today as `for_date`. |
| Add chore | Tap `+ Add`. Bottom sheet slides up: name (autofocused), assignee pill selector (all members + "Unassigned"), due date picker, notes, frequency toggle (Daily / Weekly), Save. |
| View roommate | Tap avatar. Hero card and chore list update to show only their assigned chores. Hero card CTA is read-only. |
| Switch days | Tap a day on the week strip. List, hero card, and avatar row counts all update for the selected day. |
| Join via invite link | Link opens Tidy if installed → code pre-filled → user confirms → joins immediately if signed in, or authenticates first then joins. If app not installed → web fallback with code pre-filled. |

---

## 9. Empty States

| State | Copy | CTA |
|---|---|---|
| No chores today (self, no avatar selected) | "Nothing on the list. Enjoy it while it lasts. ✦" | `+ Add chore` |
| No chores today (roommate selected) | "[Name] has nothing today." | None |
| No house yet | "Create or join a house to get started." | `Create house` / `Join house` |
| House has no other members | "Invite your roommates to get started." | `Share invite link` |

---

## 10. Out of Scope for Phase 1

- Chore rotation / auto-assignment
- Streaks, scores, leaderboards (Phase 2)
- Favor economy (Phase 3)
- Expense splitting (Phase 4)
- Rewards / monetization (Phase 5)
- Photo proof on completion
- Activity feed / social notifications
- Multiple houses per user
- User-selectable avatar color
- Chore history / audit log
