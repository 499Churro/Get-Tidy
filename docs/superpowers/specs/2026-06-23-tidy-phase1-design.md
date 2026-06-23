# Tidy — Phase 1 Design Spec

**Date:** 2026-06-23  
**Scope:** Phase 1 — Lean Core (utility layer, no gamification)  
**Stack:** Expo (React Native) + Supabase  
**Platforms:** iOS (primary), Web (accessible)

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
```

### Rules
- Any signed-in user can create a house. They become the first member automatically.
- **Phase 1 limit:** One house per user. Enforced server-side via Supabase RLS — a user cannot be inserted into `house_members` twice. Client also shows: "You're already in a house. Leave your current house first to join another."
- Leaving a house orphans that user's assigned chores (they become unassigned). The chores are not deleted.

### Joining
- **House code** — a unique 8-character code (e.g. `TIDY-4B2K`). User enters it manually in the Join screen.
- **Invite link** — the same code embedded in a deep link: `tidy.app/join/TIDY-4B2K`. Tapping it opens the app (or the web fallback) and pre-fills the code. For users without the app, the web page prompts them to download it or sign in on web.
- These are the same underlying mechanism — one code, two entry points.

### No role hierarchy
Every member has equal permissions to create, assign, edit, and delete any chore.

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

**Why a separate completions table:** A daily chore needs to be marked done once per day. A single `completed_at` on the chore would make it permanently complete after the first time. Instead, the system checks "does a completion record exist for this chore + for_date?" to determine if a chore is done on any given day. Weekly chores also use this table — they just only need one completion record per week.

### What `frequency` controls
- **Daily** chores appear in the chore list for every day of the week strip.
- **Weekly** chores appear once — on their `due_date` day only. If no `due_date` is set on a weekly chore, it appears in every day's list until completed (treated as "due sometime this week").
- The frequency label (`daily` / `weekly`) is shown on each chore card as a secondary label.

### Unassigned chores
- Appear in the full chore list for any selected day (under "All chores")
- Do **not** appear in any individual's hero card or avatar count
- Do **not** count toward any person's progress dot calculation
- Displayed without an assignee label

---

## 5. Push Notifications

Delivered via Supabase Edge Functions + Expo Push Notification Service.

| Trigger | When it fires |
|---|---|
| Chore assigned to you | Immediately when `assigned_to` is set to you |
| Chore due today | 8am in the user's stored timezone, on the `due_date` |
| Chore overdue | 8am in the user's stored timezone, the morning after the `due_date` passes without `completed_at` |

**Rules:**
- The overdue notification fires once only — the morning after the due date.
- Completing an overdue chore does not suppress a notification that already fired.
- Completing a chore before the overdue notification fires cancels it.

**Permission prompt:** Shown after the user successfully joins or creates a house, with contextual copy: *"Get reminded when your chores are due"*. Not shown at sign-up.

---

## 6. Navigation Structure

**Bottom tab bar — 2 tabs:** `Chores` (default) | `House`

### Chores Screen (top to bottom)

#### Header
Logo (gradient square + ✦) + wordmark "tidy" + house name pill (right).

#### Week Strip
- Shows Mon–Sun of the current calendar week. Resets on Monday.
- Today is highlighted with the primary gradient; all other days use the muted surface color.
- Tapping a day updates the chore list and hero card to show that day.
- Default on open: today.
- Each day shows a **progress dot** reflecting the **whole house** completion rate for that day (not the selected person's):
  - 🔴 Red — 0% of house chores complete
  - 🟠 Orange — ~25% complete
  - 🟡 Yellow — 50%+ complete
  - 🟢 Green — 100% complete
  - No dot — no chores scheduled that day
- The dot legend does **not** appear on this screen. It is shown once during onboarding.

#### Avatar Row
- Horizontal strip of all house members, including the current user ("You").
- Each avatar shows: profile photo (or initials fallback), name, completion count for the selected day (`2/3`).
- Tapping an avatar filters the hero card and chore list to show that person's chores.
- The selected avatar gets a colored ring. Tapping the current user's avatar (or tapping again) resets to the default "all chores" view.
- Completion count colors: green if complete (`3/3 ✓`), red if zero (`0/2`), orange otherwise.

#### Hero Card
- Shows the **first incomplete chore** for the selected person + day, sorted by `due_date` ascending then `created_at` ascending.
- **If viewing yourself:** coral-to-amber gradient. CTA: "Mark as done ✓".
- **If viewing a roommate:** that person's avatar color gradient. CTA is read-only: "Not done yet" (you cannot mark it done for them).
- **If all chores are complete:** hero card renders a completion state — "All done for today! ✦" on a muted surface background. Same card dimensions, no layout collapse.
- **If no chores are assigned for that day:** hero card renders a minimal empty state — "[Name] has nothing today." on a muted surface background. Same card dimensions.

#### Chore List
- All chores for the selected day and selected person (or all house chores if no avatar is selected).
- Each chore card: circular checkbox + name + frequency label + assignee + due status.
- **Overdue:** red left border, red secondary text.
- **Completed:** checkbox filled with gradient, name struck through, card dimmed (opacity 0.5).
- List order: incomplete first (sorted by `due_date` then `created_at`), completed at bottom.
- `+ Add` button in the section header.

### House Screen
- Member list with profile photos, display names
- Invite section: shows house code + share link button
- Leave house option (with confirmation)

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
On account creation, each user is assigned a color from a curated set of 8 gradients (e.g. coral, green, purple, amber, blue, pink, teal, olive). These are used as the fallback avatar background, the selected ring color, and the hero card gradient when viewing that person. Users cannot change their color in Phase 1.

### Logo
Gradient square (`border-radius: 9px`, coral-to-amber gradient) containing a ✦ star glyph in white. Followed by wordmark "tidy" in font-weight 800, `#1a1a1a`.

### Cards
`border-radius: 14px`, white background, `box-shadow: 0 2px 8px rgba(0,0,0,0.05)`.

### Bottom Nav
Floating pill, white background, `border-radius: 18px`, shadow. Tabs: icon + label. Active tab uses primary color.

### Typography
System font (`-apple-system`, `system-ui`). No custom font in Phase 1.

---

## 8. Key Interactions

| Interaction | Behavior |
|---|---|
| Mark chore done | Tap circular checkbox. Optimistic update immediately; Supabase write in background. |
| Add chore | Tap `+ Add`. Bottom sheet slides up: name field (autofocused), assignee pill selector (all members + "Unassigned"), due date picker, notes field, frequency toggle (Daily / Weekly), Save button. |
| View roommate | Tap avatar. Hero card and list update. Hero card CTA becomes read-only. |
| Switch days | Tap a day on the week strip. List and hero card update. Avatar row counts update to reflect that day. |
| Join via link | Deep link opens app → pre-fills house code → user confirms → joins house. |

---

## 9. Empty States

| State | Copy | CTA |
|---|---|---|
| No chores today (self) | "Nothing on the list. Enjoy it while it lasts. ✦" | `+ Add chore` |
| No chores today (roommate) | "[Name] has nothing today." | None |
| No house yet | "Create or join a house to get started." | `Create house` / `Join house` buttons |
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
