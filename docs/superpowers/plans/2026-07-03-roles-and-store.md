# Roles & Reward Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flexible admin/member role system, tighten RLS, replace the House tab with a Store tab (settings move to a gear-icon modal), and build a point-based reward store where admins create rewards and members spend earned points to redeem them.

**Architecture:** Phase A lays the foundation — DB migration for `role`, a `HouseSettingsSheet` modal that replaces the House tab, RLS hardening on chores/completions/house_members, and role-gated write access in the Chores tab. Phase B adds the point ledger, Store tab UI, and all store RPCs. Each phase ships independently.

**Tech Stack:** React Native (Expo), expo-router, Supabase (Postgres + RLS + RPCs), @gorhom/bottom-sheet, MaterialIcons, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-03-roles-and-store-design.md`

---

## File Map

### Phase A — New / modified files

| File | Action | What it does |
|------|--------|-------------|
| `supabase/migrations/20260703000002_phase_a_roles.sql` | Create | Adds `role` to `house_members`, fixes chore/completion/house RLS, drops self-leave policy, adds `leave_house` / `change_member_role` / `remove_member` RPCs |
| `types/database.ts` | Modify | Add `role` to `HouseMember`; remove stale `ScoreLedgerEntry` |
| `hooks/useHouseRole.ts` | Create | Returns `{ role, isAdmin }` from the members list already fetched by `useHouse` |
| `hooks/useHouse.ts` | Modify | Replace raw `house_members` delete in `leaveHouse()` with `leave_house` RPC |
| `components/house/HouseSettingsSheet.tsx` | Create | Full house settings as a bottom-sheet modal (extracted from house.tsx). Admins see role management; members see read-only. Personal goal section dropped. |
| `app/(app)/_layout.tsx` | Modify | Replace `house` tab with `store`; update `TAB_CONFIG` |
| `app/(app)/store.tsx` | Create | Phase A: empty state placeholder ("Store coming soon") |
| `app/(app)/index.tsx` | Modify | Add gear icon (⚙️) top-right; import and wire `HouseSettingsSheet` |
| `app/(app)/chores.tsx` | Modify | Add gear icon; import `HouseSettingsSheet`; gate FAB, Edit, Delete buttons behind `isAdmin` |
| `app/(app)/house.tsx` | Delete | All content moves to `HouseSettingsSheet` |

### Phase B — New / modified files

| File | Action | What it does |
|------|--------|-------------|
| `supabase/migrations/20260703000003_add_point_value_to_chores.sql` | Create | Adds `point_value integer not null default 10` to `chores` |
| `supabase/migrations/20260703000004_phase_b_store.sql` | Create | Creates `point_ledger`, `rewards`, `redemptions`; all RLS; `get_point_balance`, `redeem_reward`, `approve_redemption`, `deny_redemption` RPCs; `award_chore_points` trigger; `set_updated_at` triggers |
| `supabase/migrations/20260703000005_update_undo_completion.sql` | Create | Updates `undo_chore_completion` to also insert a `chore_completion_reversal` row into `point_ledger` |
| `types/database.ts` | Modify | Add `point_value` to `Chore`; add `PointLedger`, `Reward`, `Redemption` types |
| `hooks/usePointBalance.ts` | Create | Calls `get_point_balance` RPC; real-time subscription on `point_ledger` |
| `hooks/useRewards.ts` | Create | Fetches active rewards for the house |
| `hooks/useRedemptions.ts` | Create | Fetches redemptions — admin sees all pending; member sees own |
| `components/chores/AddChoreSheet.tsx` | Modify | Add `point_value` number input (default 10) to add/edit form |
| `app/(app)/store.tsx` | Modify | Replace placeholder with full Store screen (admin + member views) |

---

## PHASE A — Foundation

---

### Task 1: DB migration — roles, RLS hardening, leave RPCs

**Files:**
- Create: `supabase/migrations/20260703000002_phase_a_roles.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260703000002_phase_a_roles.sql

-- ── 1. Add role column ──────────────────────────────────────────────────────
alter table public.house_members
  add column role text not null default 'member'
  check (role in ('admin', 'member'));

-- Backfill: house creator becomes admin
update public.house_members hm
set role = 'admin'
from public.houses h
where hm.house_id = h.id
  and hm.user_id = h.created_by;

-- ── 2. Chore RLS: replace catch-all with read/write split ───────────────────
drop policy if exists "chores: house members" on public.chores;

create policy "members read chores"
  on public.chores for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

create policy "admins write chores"
  on public.chores for insert
  with check (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

create policy "admins update chores"
  on public.chores for update
  using (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  )
  with check (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );
-- No delete policy — archive-only via archived_at.

-- ── 3. Completion insert: restrict to caller's own or unassigned chores ──────
drop policy if exists "completions: insert own" on public.chore_completions;
-- "no completions on archived chores" (restrictive) is intentionally kept.

create policy "completions: insert own"
  on public.chore_completions for insert
  with check (
    completed_by = auth.uid()
    and chore_id in (
      select id from public.chores
      where house_id in (
        select house_id from public.house_members where user_id = auth.uid()
      )
      and archived_at is null
      and (assigned_to = auth.uid() or assigned_to is null)
    )
  );

-- ── 4. Houses: admins can update house name ─────────────────────────────────
create policy "admins update house"
  on public.houses for update
  using (
    id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  )
  with check (
    id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ── 5. Self-leave: replace raw delete with RPC ──────────────────────────────
drop policy if exists "house_members: leave" on public.house_members;

create or replace function public.leave_house(p_house_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller    uuid := auth.uid();
  v_role      text;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select role into v_role
  from public.house_members
  where house_id = p_house_id and user_id = v_caller;
  if not found then raise exception 'not a member of this house'; end if;

  if v_role = 'admin' then
    select count(*) into v_admin_count
    from public.house_members
    where house_id = p_house_id and role = 'admin' and user_id != v_caller;
    if v_admin_count = 0 then
      raise exception 'cannot leave — you are the only admin. Promote another member first.';
    end if;
  end if;

  delete from public.house_members where house_id = p_house_id and user_id = v_caller;
end;
$$;

-- ── 6. Role management RPCs ─────────────────────────────────────────────────
create or replace function public.change_member_role(
  p_target_user_id uuid,
  p_new_role        text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller      uuid := auth.uid();
  v_house_id    uuid;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_new_role not in ('admin', 'member') then raise exception 'invalid role'; end if;

  select hm.house_id into v_house_id
  from public.house_members hm
  where hm.user_id = v_caller and hm.role = 'admin'
    and hm.house_id = (
      select house_id from public.house_members where user_id = p_target_user_id limit 1
    );
  if v_house_id is null then raise exception 'not authorized'; end if;

  if p_new_role = 'member' then
    select count(*) into v_admin_count
    from public.house_members
    where house_id = v_house_id and role = 'admin' and user_id != p_target_user_id;
    if v_admin_count = 0 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  update public.house_members
  set role = p_new_role
  where house_id = v_house_id and user_id = p_target_user_id;
end;
$$;

create or replace function public.remove_member(p_target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller      uuid := auth.uid();
  v_house_id    uuid;
  v_target_role text;
  v_admin_count int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select hm.house_id into v_house_id
  from public.house_members hm
  where hm.user_id = v_caller and hm.role = 'admin'
    and hm.house_id = (
      select house_id from public.house_members where user_id = p_target_user_id limit 1
    );
  if v_house_id is null then raise exception 'not authorized'; end if;

  select role into v_target_role
  from public.house_members
  where house_id = v_house_id and user_id = p_target_user_id;

  if v_target_role = 'admin' then
    select count(*) into v_admin_count
    from public.house_members
    where house_id = v_house_id and role = 'admin' and user_id != p_target_user_id;
    if v_admin_count = 0 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  delete from public.house_members
  where house_id = v_house_id and user_id = p_target_user_id;
end;
$$;
```

- [ ] **Step 2: Push migration to Supabase**

```bash
npx supabase db push
```

Expected: migration applied with no errors. If prompted for confirmation, answer Y.

- [ ] **Step 3: Smoke-test in Supabase dashboard SQL editor**

```sql
-- Verify role column exists and backfill ran
select user_id, role from public.house_members limit 10;
-- House creator should show role = 'admin', others = 'member'

-- Verify new policies exist
select policyname, cmd from pg_policies
where tablename in ('chores', 'chore_completions', 'houses', 'house_members')
order by tablename, policyname;
```

Expected: no `"chores: house members"` row, no `"completions: insert own"` (old one), no `"house_members: leave"` policy. New policies present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260703000002_phase_a_roles.sql
git commit -m "feat: Phase A migration — role column, RLS hardening, leave/role-management RPCs"
```

---

### Task 2: TypeScript types — add role, remove stale score ledger types

**Files:**
- Modify: `types/database.ts`

The current `HouseMember` interface is missing `role`. The `ScoreLedgerEntry` and `ScoreLedgerEventType` types are stale (score_ledger table was dropped in migration 20260702000007).

- [ ] **Step 1: Update `HouseMember` to include `role`**

In `types/database.ts`, change:
```typescript
export interface HouseMember {
  id: string
  house_id: string
  user_id: string
  joined_at: string
  profile?: Profile
}
```
To:
```typescript
export interface HouseMember {
  id: string
  house_id: string
  user_id: string
  role: 'admin' | 'member'
  joined_at: string
  profile?: Profile
}
```

- [ ] **Step 2: Remove stale score ledger types**

Remove the `ScoreLedgerEventType` type alias and `ScoreLedgerEntry` interface entirely. The `score_ledger` table no longer exists. TypeScript will now catch any remaining references to those types.

- [ ] **Step 3: Verify no broken references**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: any `ScoreLedgerEntry` references will now be type errors — fix them by removing the reference. There should be none in active app code (it was only in types).

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "refactor: add role to HouseMember type, remove stale score_ledger types"
```

---

### Task 3: `useHouseRole` hook

**Files:**
- Create: `hooks/useHouseRole.ts`

This hook reads the current user's role from the `members` array already loaded by `useHouse`. No extra Supabase query needed.

- [ ] **Step 1: Create `hooks/useHouseRole.ts`**

```typescript
import { useMemo } from 'react'
import { HouseMember } from '@/types/database'

export function useHouseRole(
  members: HouseMember[],
  currentUserId: string | undefined
): { role: 'admin' | 'member' | null; isAdmin: boolean } {
  return useMemo(() => {
    if (!currentUserId) return { role: null, isAdmin: false }
    const me = members.find(m => m.user_id === currentUserId)
    const role = me?.role ?? null
    return { role, isAdmin: role === 'admin' }
  }, [members, currentUserId])
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/useHouseRole.ts
git commit -m "feat: add useHouseRole hook"
```

---

### Task 4: Update `useHouse.leaveHouse` to use RPC

**Files:**
- Modify: `hooks/useHouse.ts` (lines 62–76)

Currently `leaveHouse()` does a raw `supabase.from('house_members').delete().eq('user_id', userId)`. The Phase A migration dropped the self-leave RLS policy, so this raw delete will now fail. Replace it with the `leave_house` RPC.

- [ ] **Step 1: Replace `leaveHouse` implementation**

In `hooks/useHouse.ts`, replace:
```typescript
async function leaveHouse(): Promise<{ error: string | null }> {
  if (house) {
    await supabase
      .from('chores')
      .update({ assigned_to: null })
      .eq('house_id', house.id)
      .eq('assigned_to', userId)
  }
  const { error } = await supabase.from('house_members').delete().eq('user_id', userId)
  if (!error) {
    notifyHouseMembershipChanged()
    await fetchHouse()
  }
  return { error: error?.message ?? null }
}
```
With:
```typescript
async function leaveHouse(): Promise<{ error: string | null }> {
  if (!house) return { error: 'No house to leave.' }
  // Unassign caller's chores first (best-effort; RPC handles the membership deletion)
  await supabase
    .from('chores')
    .update({ assigned_to: null })
    .eq('house_id', house.id)
    .eq('assigned_to', userId)
  const { error } = await supabase.rpc('leave_house', { p_house_id: house.id })
  if (!error) {
    notifyHouseMembershipChanged()
    await fetchHouse()
  }
  return { error: error?.message ?? null }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Manual test — leave house flow**

Sign in as a member (not the sole admin). Tap "Leave house" in the current House screen. Should succeed and redirect to onboarding. Then test as the only admin — should show the error message "cannot leave — you are the only admin."

- [ ] **Step 4: Commit**

```bash
git add hooks/useHouse.ts
git commit -m "fix: replace raw house_members delete in leaveHouse with leave_house RPC"
```

---

### Task 5: `HouseSettingsSheet` component

**Files:**
- Create: `components/house/HouseSettingsSheet.tsx`

This is the extracted and extended house settings, presented as a `@gorhom/bottom-sheet` modal. It replaces the House tab screen. Study `app/(app)/house.tsx` closely — nearly all its content moves here, with two removals (personal goal section dropped) and two additions (role management in member list, "Change role" / "Remove member" actions for admins).

The sheet accepts a `visible` prop + `onClose` callback. It is not a `BottomSheet` ref-based sheet — use a full-screen `Modal` with a slide-up inner sheet to match the profile edit modal pattern already in the codebase.

- [ ] **Step 1: Create `components/house/HouseSettingsSheet.tsx`**

```typescript
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView,
  Share, Linking, Modal, TextInput, ActivityIndicator, Image,
} from 'react-native'
import { useState } from 'react'
import { LinearGradient } from 'expo-linear-gradient'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useHouseRole } from '@/hooks/useHouseRole'
import { useMomentum } from '@/context/MomentumContext'
import { Avatar } from '@/components/ui/Avatar'
import { Colors, Fonts, Shadows, AvatarGradients } from '@/constants/theme'
import { useUserAccent } from '@/context/UserAccentContext'
import { supabase } from '@/lib/supabase'
import { HouseMomentum } from '@/types/database'

function getRecapCopy(m: HouseMomentum): string {
  const remaining = m.target_days - m.active_days
  if (m.active_days >= m.target_days) {
    return m.reward_text ? `${m.reward_text} unlocked. Well done.` : 'Goal reached. Well done.'
  }
  if (remaining <= 3) {
    return m.reward_text
      ? `So close — ${remaining} more day${remaining === 1 ? '' : 's'} to ${m.reward_text}.`
      : `${remaining} more day${remaining === 1 ? '' : 's'} to go.`
  }
  return m.reward_text
    ? `${m.active_days} days in. ${m.reward_text} is in reach.`
    : `${m.active_days} days in this month.`
}

interface HouseSettingsSheetProps {
  visible: boolean
  onClose: () => void
}

export function HouseSettingsSheet({ visible, onClose }: HouseSettingsSheetProps) {
  const { accentColor } = useUserAccent()
  const { session, profile, updateProfile } = useAuth()
  const { house, members, leaveHouse, refetch: refetchHouse } = useHouse(session?.user.id)
  const { isAdmin } = useHouseRole(members, session?.user.id)
  const { momentum, loading: momentumLoading, goal, saveGoal } = useMomentum()

  // Profile edit state
  const [editOpen, setEditOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState(0)
  const [draftAvatarUri, setDraftAvatarUri] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // House goal edit state
  const [goalDraft, setGoalDraft] = useState('')
  const [goalEditing, setGoalEditing] = useState(false)
  const [targetDaysDraft, setTargetDaysDraft] = useState('20')

  if (!house) return null

  async function handleShareCode() {
    await Share.share({ message: `Join my house on Tidy!\n\nCode: ${house!.code}\nhttps://tidy.app/join/${house!.code}` })
  }

  async function handleLeave() {
    Alert.alert(
      'Leave house?',
      'Your assigned chores will become unassigned. You can rejoin with the same code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const { error } = await leaveHouse()
            if (error) Alert.alert('Cannot leave', error)
            else onClose()
          },
        },
      ]
    )
  }

  async function handleChangeRole(targetUserId: string, currentRole: 'admin' | 'member') {
    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    const label = newRole === 'admin' ? 'Make admin' : 'Make member'
    Alert.alert(
      label,
      `Change this member to ${newRole}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: label,
          onPress: async () => {
            const { error } = await supabase.rpc('change_member_role', {
              p_target_user_id: targetUserId,
              p_new_role: newRole,
            })
            if (error) Alert.alert('Error', error.message)
            else refetchHouse()
          },
        },
      ]
    )
  }

  async function handleRemoveMember(targetUserId: string, displayName: string) {
    Alert.alert(
      'Remove member?',
      `Remove ${displayName} from the house?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('remove_member', {
              p_target_user_id: targetUserId,
            })
            if (error) Alert.alert('Error', error.message)
            else refetchHouse()
          },
        },
      ]
    )
  }

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (!result.canceled) setDraftAvatarUri(result.assets[0].uri)
  }

  async function handleSaveProfile() {
    if (!draftName.trim()) return
    setSaving(true)
    try {
      let avatar_url: string | undefined
      if (draftAvatarUri && session?.user.id) {
        const ext = draftAvatarUri.split('.').pop()?.split('?')[0] ?? 'jpg'
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
        const path = `${session.user.id}/avatar.${ext}`
        const response = await fetch(draftAvatarUri)
        const arrayBuffer = await response.arrayBuffer()
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, arrayBuffer, { contentType: mime, upsert: true })
        if (uploadError) { Alert.alert('Photo upload failed', uploadError.message); return }
        const { data } = supabase.storage.from('avatars').getPublicUrl(path)
        avatar_url = `${data.publicUrl}?t=${Date.now()}`
      }
      const { error } = await updateProfile(
        { display_name: draftName.trim(), avatar_color_index: draftColor, ...(avatar_url ? { avatar_url } : {}) },
        { applyImmediately: true }
      )
      if (error) { Alert.alert('Error', error); return }
      setEditOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>House Settings</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* House name + code */}
            <View style={styles.card}>
              <Text style={styles.houseName}>{house.name}</Text>
              <Text style={styles.codeLabel}>House Code</Text>
              <View style={styles.codeRow}>
                <Text style={styles.code}>{house.code}</Text>
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleShareCode} activeOpacity={0.8}>
                <Text style={styles.primaryBtnText}>Share Code</Text>
              </TouchableOpacity>
            </View>

            {/* House goal (everyone sees bar; admin can edit) */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>House goal</Text>
              {!goal ? (
                isAdmin ? (
                  <View style={styles.card}>
                    <Text style={styles.emptyTitle}>Set a house goal</Text>
                    <TextInput
                      style={styles.input}
                      value={goalDraft}
                      onChangeText={setGoalDraft}
                      placeholder="e.g. Movie night"
                      placeholderTextColor={Colors.onSurfaceVariant}
                      autoCapitalize="sentences"
                      returnKeyType="done"
                    />
                    <TextInput
                      style={[styles.input, { marginTop: 8 }]}
                      value={targetDaysDraft}
                      onChangeText={v => setTargetDaysDraft(v.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      placeholder="Active days target (e.g. 20)"
                      placeholderTextColor={Colors.onSurfaceVariant}
                    />
                    <TouchableOpacity
                      style={[styles.primaryBtn, { marginTop: 12, opacity: goalDraft.trim() ? 1 : 0.4 }]}
                      disabled={!goalDraft.trim()}
                      onPress={() => {
                        const days = Math.max(1, parseInt(targetDaysDraft) || 20)
                        void saveGoal(goalDraft.trim(), 90, days)
                        setGoalDraft('')
                        setTargetDaysDraft('20')
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.primaryBtnText}>Set goal</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.card}>
                    <Text style={styles.emptyBody}>No house goal set yet. Ask an admin to create one.</Text>
                  </View>
                )
              ) : (
                <View style={styles.card}>
                  {momentum ? (
                    <>
                      <View style={styles.meterTrack}>
                        <View style={[styles.meterFill, { width: `${Math.min(100, Math.round((momentum.active_days / momentum.target_days) * 100))}%` }]} />
                      </View>
                      {goalEditing && isAdmin ? (
                        <>
                          <TextInput
                            style={[styles.input, { marginTop: 4 }]}
                            value={goalDraft}
                            onChangeText={setGoalDraft}
                            placeholder="Reward text"
                            placeholderTextColor={Colors.onSurfaceVariant}
                            autoFocus
                          />
                          <TextInput
                            style={[styles.input, { marginTop: 8 }]}
                            value={targetDaysDraft}
                            onChangeText={v => setTargetDaysDraft(v.replace(/[^0-9]/g, ''))}
                            keyboardType="number-pad"
                            placeholder="Active days target"
                            placeholderTextColor={Colors.onSurfaceVariant}
                          />
                          <View style={styles.rowActions}>
                            <TouchableOpacity
                              style={[styles.primaryBtn, { flex: 1, opacity: goalDraft.trim() ? 1 : 0.4 }]}
                              disabled={!goalDraft.trim()}
                              onPress={() => {
                                const days = Math.max(1, parseInt(targetDaysDraft) || 20)
                                void saveGoal(goalDraft.trim(), goal.target_pct, days)
                                setGoalEditing(false)
                                setGoalDraft('')
                              }}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.primaryBtnText}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setGoalEditing(false); setGoalDraft('') }}>
                              <Text style={styles.cancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <TouchableOpacity
                          onPress={isAdmin ? () => {
                            setGoalDraft(goal.reward_text)
                            setTargetDaysDraft(goal.target_days.toString())
                            setGoalEditing(true)
                          } : undefined}
                          activeOpacity={isAdmin ? 0.7 : 1}
                        >
                          <Text style={styles.meterLabel}>
                            {momentum.active_days} / {momentum.target_days} days{goal.reward_text ? ` — ${goal.reward_text}` : ''}
                            {isAdmin ? '  ✏️' : ''}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.recapCopy}>{getRecapCopy(momentum)}</Text>
                    </>
                  ) : momentumLoading ? (
                    <ActivityIndicator color={Colors.primary} />
                  ) : null}
                </View>
              )}
            </View>

            {/* Members */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Members ({members.length})</Text>
              <View style={styles.card}>
                {members.map((m, idx) => {
                  if (!m.profile) return null
                  const isMe = m.user_id === session?.user.id
                  return (
                    <View
                      key={m.user_id}
                      style={[styles.memberRow, idx > 0 && styles.memberRowBorder]}
                    >
                      <TouchableOpacity
                        onPress={isMe ? () => {
                          setDraftName(profile?.display_name ?? '')
                          setDraftColor(profile?.avatar_color_index ?? 0)
                          setDraftAvatarUri(null)
                          setEditOpen(true)
                        } : undefined}
                        activeOpacity={isMe ? 0.7 : 1}
                        style={styles.memberRowInner}
                      >
                        <Avatar
                          uri={m.profile.avatar_url}
                          displayName={m.profile.display_name}
                          colorIndex={m.profile.avatar_color_index}
                          size={44}
                        />
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName}>
                            {isMe ? `${m.profile.display_name} (you)` : m.profile.display_name}
                          </Text>
                          <Text style={styles.memberStatus}>{m.role === 'admin' ? 'Admin' : 'Member'}</Text>
                        </View>
                        {m.role === 'admin' && (
                          <View style={styles.adminBadge}>
                            <Text style={styles.adminBadgeText}>Admin</Text>
                          </View>
                        )}
                        {isMe && <Text style={styles.editHint}>Edit →</Text>}
                      </TouchableOpacity>
                      {/* Admin actions (not on self) */}
                      {isAdmin && !isMe && (
                        <View style={styles.adminActions}>
                          <TouchableOpacity
                            style={styles.roleBtn}
                            onPress={() => handleChangeRole(m.user_id, m.role)}
                          >
                            <Text style={styles.roleBtnText}>
                              {m.role === 'admin' ? 'Demote' : 'Promote'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.removeBtn}
                            onPress={() => handleRemoveMember(m.user_id, m.profile!.display_name)}
                          >
                            <Text style={styles.removeBtnText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            </View>

            {/* Notifications */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notifications</Text>
              <View style={styles.card}>
                <Text style={styles.notifHint}>Manage chore notification preferences in your device settings.</Text>
                <View style={styles.divider} />
                <TouchableOpacity onPress={() => Linking.openSettings()} activeOpacity={0.7}>
                  <Text style={styles.linkText}>Open notification settings →</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Leave house */}
            <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave} activeOpacity={0.7}>
              <Text style={styles.leaveBtnText}>Leave house</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Edit Profile Modal (nested) */}
          <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
            <View style={styles.overlay}>
              <View style={styles.sheet}>
                <View style={styles.handle} />
                <Text style={[styles.title, { marginBottom: 16 }]}>Edit your profile</Text>

                <ScrollView>
                  <Text style={styles.inputLabel}>Profile photo</Text>
                  <TouchableOpacity onPress={pickPhoto} style={styles.photoRow} activeOpacity={0.7}>
                    {draftAvatarUri ? (
                      <Image source={{ uri: draftAvatarUri }} style={styles.photoPreview} />
                    ) : profile?.avatar_url ? (
                      <Image source={{ uri: profile.avatar_url }} style={styles.photoPreview} />
                    ) : (
                      <View style={styles.photoPlaceholder}><Text style={{ fontSize: 22, color: Colors.onSurfaceVariant }}>＋</Text></View>
                    )}
                    <Text style={styles.linkText}>{draftAvatarUri || profile?.avatar_url ? 'Change photo' : 'Add photo'}</Text>
                  </TouchableOpacity>

                  <Text style={styles.inputLabel}>Display name</Text>
                  <TextInput
                    style={styles.input}
                    value={draftName}
                    onChangeText={setDraftName}
                    placeholder="Your name"
                    placeholderTextColor={Colors.onSurfaceVariant}
                    autoCapitalize="words"
                  />

                  <Text style={styles.inputLabel}>Your color</Text>
                  <View style={styles.colorGrid}>
                    {AvatarGradients.map(([start, end], idx) => (
                      <TouchableOpacity key={idx} onPress={() => setDraftColor(idx)} activeOpacity={0.8} style={styles.colorSwatch}>
                        <LinearGradient colors={[start, end]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                          style={[styles.colorSwatchGrad, draftColor === idx && styles.colorSwatchSelected]} />
                        {draftColor === idx && <Text style={styles.colorCheck}>✓</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: accentColor, marginTop: 20, opacity: (!draftName.trim() || saving) ? 0.4 : 1 }]}
                    onPress={handleSaveProfile}
                    disabled={!draftName.trim() || saving}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditOpen(false)} style={{ paddingVertical: 12, alignItems: 'center' }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </View>
          </Modal>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '92%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginVertical: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface },
  closeBtn: { fontSize: 18, color: Colors.onSurfaceVariant },
  content: { gap: 20, paddingBottom: 24 },

  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    ...Shadows.card,
  },
  houseName: { fontSize: 22, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 12, textAlign: 'center' },
  codeLabel: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.outline, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', marginBottom: 8 },
  codeRow: { backgroundColor: Colors.surfaceContainerLow, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10, borderWidth: 1, borderColor: Colors.outlineVariant, alignItems: 'center', marginBottom: 14 },
  code: { fontSize: 24, fontFamily: Fonts.bold, color: Colors.primary, letterSpacing: 3 },

  section: { gap: 10 },
  sectionTitle: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.onSurface },

  emptyTitle: { fontSize: 16, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 8 },
  emptyBody: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },

  meterTrack: { height: 8, backgroundColor: Colors.surfaceContainerHigh, borderRadius: 999, overflow: 'hidden', marginBottom: 12 },
  meterFill: { height: 8, backgroundColor: Colors.primary, borderRadius: 999 },
  meterLabel: { fontSize: 15, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 6 },
  recapCopy: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, marginTop: 4 },

  memberRow: { paddingVertical: 10 },
  memberRowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  memberRowInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  memberStatus: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  adminBadge: { backgroundColor: Colors.primaryFixed, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  adminBadgeText: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.primary },
  editHint: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  adminActions: { flexDirection: 'row', gap: 8, marginTop: 8, paddingLeft: 56 },
  roleBtn: { backgroundColor: Colors.surfaceContainerLow, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  roleBtnText: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
  removeBtn: { backgroundColor: Colors.errorContainer, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  removeBtnText: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.error },

  notifHint: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, paddingVertical: 4 },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 8 },
  linkText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.primary },

  leaveBtn: { paddingVertical: 16, alignItems: 'center' },
  leaveBtnText: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.error },

  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { fontSize: 14, fontFamily: Fonts.bold, color: '#fff' },
  rowActions: { flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'center' },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },

  input: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: Fonts.semibold,
    color: Colors.onSurface,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  inputLabel: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.outline, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  photoPreview: { width: 56, height: 56, borderRadius: 28 },
  photoPlaceholder: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  colorSwatch: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  colorSwatchGrad: { width: 44, height: 44, borderRadius: 22, position: 'absolute' },
  colorSwatchSelected: { width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: Colors.onSurface },
  colorCheck: { fontSize: 18, color: '#fff', fontFamily: Fonts.bold },
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Fix any errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add components/house/HouseSettingsSheet.tsx
git commit -m "feat: HouseSettingsSheet — gear-icon modal with role management"
```

---

### Task 6: Update tab navigation — House → Store

**Files:**
- Modify: `app/(app)/_layout.tsx`
- Create: `app/(app)/store.tsx` (Phase A placeholder)
- Delete: `app/(app)/house.tsx`

- [ ] **Step 1: Update `TAB_CONFIG` and `Tabs.Screen` entries in `_layout.tsx`**

Change:
```typescript
const TAB_CONFIG: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  chores: { label: 'Chores', icon: 'checklist' },
  house: { label: 'House', icon: 'people' },
}
```
To:
```typescript
const TAB_CONFIG: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  chores: { label: 'Chores', icon: 'checklist' },
  store: { label: 'Store', icon: 'storefront' },
}
```

Change `<Tabs.Screen name="house" />` to `<Tabs.Screen name="store" />`.

- [ ] **Step 2: Create placeholder `app/(app)/store.tsx`**

```typescript
import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { MaterialIcons } from '@expo/vector-icons'
import { TouchableOpacity } from 'react-native'
import { HouseSettingsSheet } from '@/components/house/HouseSettingsSheet'
import { Colors, Fonts } from '@/constants/theme'

export default function StoreScreen() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Store</Text>
          <Text style={styles.headerSub}>Rewards coming soon</Text>
        </View>
        <TouchableOpacity onPress={() => setSettingsOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <MaterialIcons name="settings" size={24} color={Colors.onSurfaceVariant} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <Text style={styles.emptyIcon}>🏪</Text>
        <Text style={styles.emptyTitle}>Store coming soon</Text>
        <Text style={styles.emptyBody}>Complete chores to earn points. Spend them on custom rewards set by your admin.</Text>
      </View>

      <HouseSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  headerTitle: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.primary },
  headerSub: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 64 },
  emptyTitle: { fontSize: 22, fontFamily: Fonts.bold, color: Colors.onSurface },
  emptyBody: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 20 },
})
```

- [ ] **Step 3: Delete `app/(app)/house.tsx`**

```bash
rm app/\(app\)/house.tsx
```

- [ ] **Step 4: Verify TypeScript compiles and no imports of house.tsx remain**

```bash
npx tsc --noEmit 2>&1 | head -20
grep -r "from.*house\b" app/ hooks/ components/ --include="*.tsx" --include="*.ts"
```

Fix any remaining import of the deleted `house.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/_layout.tsx app/\(app\)/store.tsx
git rm app/\(app\)/house.tsx
git commit -m "feat: replace House tab with Store tab placeholder, delete house.tsx"
```

---

### Task 7: Add gear icon to Home and Chores tabs

**Files:**
- Modify: `app/(app)/index.tsx`
- Modify: `app/(app)/chores.tsx`

Both screens need a ⚙️ gear icon in the top-right of their header that opens `HouseSettingsSheet`.

- [ ] **Step 1: Add gear icon + settings sheet to `app/(app)/index.tsx`**

At the top of the file, add:
```typescript
import { useState } from 'react'  // already imported, just add useState if not there
import { MaterialIcons } from '@expo/vector-icons'
import { TouchableOpacity } from 'react-native'
import { HouseSettingsSheet } from '@/components/house/HouseSettingsSheet'
```

Add state near the top of the component:
```typescript
const [settingsOpen, setSettingsOpen] = useState(false)
```

In the header JSX (the row that contains `TidyLogo` and the greeting), add the gear button on the right end:
```typescript
<TouchableOpacity
  onPress={() => setSettingsOpen(true)}
  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
>
  <MaterialIcons name="settings" size={22} color={Colors.onSurfaceVariant} />
</TouchableOpacity>
```

Before the closing `</SafeAreaView>` tag, add:
```typescript
<HouseSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

- [ ] **Step 2: Add gear icon + settings sheet to `app/(app)/chores.tsx`**

Same pattern as index.tsx — import `MaterialIcons`, `TouchableOpacity`, `HouseSettingsSheet`, `useState`. Add `settingsOpen` state. Add gear button to the right side of the existing header. Add `HouseSettingsSheet` before the closing `</SafeAreaView>`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/index.tsx app/\(app\)/chores.tsx
git commit -m "feat: add gear icon to Home and Chores tabs opening HouseSettingsSheet"
```

---

### Task 8: Gate write actions in Chores tab behind `isAdmin`

**Files:**
- Modify: `app/(app)/chores.tsx`

Currently ALL members see the Edit and ✕ (archive) buttons. Members should see a read-only list — no FAB, no Edit button, no Delete/Archive button.

- [ ] **Step 1: Import `useHouseRole` and derive `isAdmin` in `chores.tsx`**

Add import:
```typescript
import { useHouseRole } from '@/hooks/useHouseRole'
```

After the existing hook calls:
```typescript
const { isAdmin } = useHouseRole(members, session?.user.id)
```

- [ ] **Step 2: Gate the FAB behind `isAdmin`**

Wrap the FAB `<TouchableOpacity>` with `{isAdmin && (…)}`.

- [ ] **Step 3: Gate Edit and ✕ buttons behind `isAdmin`**

Inside the chore card map, wrap the `<View style={styles.choreActions}>` block with `{isAdmin && (…)}`.

- [ ] **Step 4: Remove the `confirmDelete` function's internal call to `deleteChore` and rename the UI label**

The function already calls `deleteChore` which does `archived_at` update (not hard delete). Rename the Alert button label from `'Delete'` to `'Archive'` to match the actual behavior:

In `confirmDelete`:
- Change alert title to `'Archive chore?'`
- Change destructive button text from `'Delete'` to `'Archive'`

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Manual test**

Sign in as a member. Open Chores tab — FAB and action buttons should be invisible. Sign in as admin — FAB and buttons should appear.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/chores.tsx
git commit -m "feat: gate chores write actions behind isAdmin role"
```

---

### Task 9: Phase A smoke test + OTA push

- [ ] **Step 1: Run the app in dev build**

```bash
npx expo start
```

Test the following manually:
- Tap gear icon on Home tab → `HouseSettingsSheet` opens
- Tap gear icon on Chores tab → same sheet opens
- Tap gear icon on Store tab → same sheet opens
- As member: Chores tab has no + FAB, no Edit/Archive buttons
- As admin: Chores tab shows + FAB and action buttons
- Leave house as admin with another admin present → succeeds
- Leave house as sole admin → error alert fires with "cannot leave"
- Admin can change a member's role (Promote/Demote buttons visible in settings sheet)
- Admin can remove a member

- [ ] **Step 2: Push OTA update**

```bash
eas update --branch production --environment production --message "Phase A: roles, settings gear icon, store tab placeholder"
```

---

## PHASE B — Point Ledger & Store

---

### Task 10: DB migration — `point_value` on chores

**Files:**
- Create: `supabase/migrations/20260703000003_add_point_value_to_chores.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260703000003_add_point_value_to_chores.sql
alter table public.chores
  add column point_value integer not null default 10
  check (point_value > 0);
```

- [ ] **Step 2: Push and verify**

```bash
npx supabase db push
```

```sql
-- In Supabase dashboard
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'chores' and column_name = 'point_value';
```

Expected: row returned with `integer`, default `10`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260703000003_add_point_value_to_chores.sql
git commit -m "feat: add point_value column to chores"
```

---

### Task 11: DB migration — store tables, RPCs, triggers

**Files:**
- Create: `supabase/migrations/20260703000004_phase_b_store.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/20260703000004_phase_b_store.sql

-- ── point_ledger ─────────────────────────────────────────────────────────────
create table public.point_ledger (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null references public.houses(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     integer not null,
  reason     text not null check (reason in (
    'chore_completion', 'chore_completion_reversal', 'reward_redemption'
  )),
  chore_id   uuid references public.chores(id) on delete set null,
  reward_id  uuid,   -- FK added after rewards table is created below
  created_at timestamptz not null default now()
);

alter table public.point_ledger enable row level security;
create policy "members read own ledger"
  on public.point_ledger for select
  using (
    user_id = auth.uid()
    or house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ── Award points on chore completion ─────────────────────────────────────────
create or replace function public.award_chore_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_house_id uuid;
  v_points   integer;
begin
  select house_id, point_value into v_house_id, v_points
  from public.chores where id = new.chore_id;
  insert into public.point_ledger (house_id, user_id, amount, reason, chore_id)
  values (v_house_id, new.completed_by, v_points, 'chore_completion', new.chore_id);
  return new;
end;
$$;

create trigger trg_award_chore_points
  after insert on public.chore_completions
  for each row execute function public.award_chore_points();

-- ── rewards ──────────────────────────────────────────────────────────────────
create table public.rewards (
  id               uuid primary key default gen_random_uuid(),
  house_id         uuid not null references public.houses(id) on delete cascade,
  created_by       uuid not null references public.profiles(id),
  name             text not null,
  emoji            text not null default '🎁',
  point_cost       integer not null check (point_cost > 0),
  requires_approval boolean not null default false,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.rewards enable row level security;
create policy "house members read rewards"
  on public.rewards for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));
create policy "admins manage rewards"
  on public.rewards for all
  using (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  )
  with check (
    house_id in (
      select house_id from public.house_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- ── redemptions ───────────────────────────────────────────────────────────────
create table public.redemptions (
  id                    uuid primary key default gen_random_uuid(),
  house_id              uuid not null references public.houses(id) on delete cascade,
  reward_id             uuid not null references public.rewards(id) on delete cascade,
  user_id               uuid not null references public.profiles(id) on delete cascade,
  status                text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  point_cost_at_request integer not null,
  reward_name_snapshot  text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

alter table public.redemptions enable row level security;
create policy "members read own redemptions"
  on public.redemptions for select
  using (user_id = auth.uid() or house_id in (
    select house_id from public.house_members
    where user_id = auth.uid() and role = 'admin'
  ));

-- ── FK: point_ledger.reward_id → rewards (both tables now exist) ──────────────
alter table public.point_ledger
  add constraint point_ledger_reward_id_fkey
  foreign key (reward_id) references public.rewards(id) on delete set null;

-- ── get_point_balance RPC ─────────────────────────────────────────────────────
create or replace function public.get_point_balance(p_house_id uuid)
returns integer language sql security invoker set search_path = public as $$
  select coalesce(sum(amount), 0)::integer
  from public.point_ledger
  where house_id = p_house_id and user_id = auth.uid();
$$;

-- ── redeem_reward RPC ─────────────────────────────────────────────────────────
create or replace function public.redeem_reward(p_reward_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller    uuid := auth.uid();
  v_reward    record;
  v_balance   integer;
  v_is_member boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_reward from public.rewards where id = p_reward_id and active = true;
  if not found then raise exception 'reward not found'; end if;

  select exists(
    select 1 from public.house_members
    where house_id = v_reward.house_id and user_id = v_caller
  ) into v_is_member;
  if not v_is_member then raise exception 'not a member of this house'; end if;

  perform pg_advisory_xact_lock(hashtext(v_caller::text || v_reward.house_id::text));

  select get_point_balance(v_reward.house_id) into v_balance;
  if v_balance < v_reward.point_cost then
    return jsonb_build_object('error', 'insufficient_points');
  end if;

  insert into public.redemptions (
    house_id, reward_id, user_id, status,
    point_cost_at_request, reward_name_snapshot
  ) values (
    v_reward.house_id, p_reward_id, v_caller,
    case when v_reward.requires_approval then 'pending' else 'approved' end,
    v_reward.point_cost, v_reward.name
  );

  if not v_reward.requires_approval then
    insert into public.point_ledger (house_id, user_id, amount, reason, reward_id)
    values (v_reward.house_id, v_caller, -v_reward.point_cost, 'reward_redemption', p_reward_id);
  end if;

  return jsonb_build_object('status',
    case when v_reward.requires_approval then 'pending' else 'approved' end);
end;
$$;

-- ── approve_redemption RPC ────────────────────────────────────────────────────
create or replace function public.approve_redemption(p_redemption_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller     uuid := auth.uid();
  v_redemption record;
  v_is_admin   boolean;
  v_balance    integer;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_redemption from public.redemptions
  where id = p_redemption_id for update;
  if not found or v_redemption.status <> 'pending' then
    raise exception 'redemption not found or not pending';
  end if;

  select exists(
    select 1 from public.house_members
    where house_id = v_redemption.house_id and user_id = v_caller and role = 'admin'
  ) into v_is_admin;
  if not v_is_admin then raise exception 'not an admin'; end if;

  perform pg_advisory_xact_lock(
    hashtext(v_redemption.user_id::text || v_redemption.house_id::text)
  );

  -- Check the MEMBER's balance (not the admin's)
  select coalesce(sum(amount), 0)::integer into v_balance
  from public.point_ledger
  where house_id = v_redemption.house_id and user_id = v_redemption.user_id;
  if v_balance < v_redemption.point_cost_at_request then
    return jsonb_build_object('error', 'insufficient_points');
  end if;

  update public.redemptions
  set status = 'approved', resolved_at = now(), updated_at = now()
  where id = p_redemption_id;

  insert into public.point_ledger (house_id, user_id, amount, reason, reward_id)
  values (v_redemption.house_id, v_redemption.user_id,
          -v_redemption.point_cost_at_request, 'reward_redemption', v_redemption.reward_id);

  return jsonb_build_object('status', 'approved');
end;
$$;

-- ── deny_redemption RPC ───────────────────────────────────────────────────────
create or replace function public.deny_redemption(p_redemption_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller     uuid := auth.uid();
  v_redemption record;
  v_is_admin   boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_redemption from public.redemptions
  where id = p_redemption_id for update;
  if not found or v_redemption.status <> 'pending' then
    raise exception 'redemption not found or not pending';
  end if;

  select exists(
    select 1 from public.house_members
    where house_id = v_redemption.house_id and user_id = v_caller and role = 'admin'
  ) into v_is_admin;
  if not v_is_admin then raise exception 'not an admin'; end if;

  update public.redemptions
  set status = 'denied', resolved_at = now(), updated_at = now()
  where id = p_redemption_id;

  return jsonb_build_object('status', 'denied');
end;
$$;

-- ── updated_at auto-maintenance triggers ──────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger set_rewards_updated_at
  before update on public.rewards
  for each row execute function public.set_updated_at();

create trigger set_redemptions_updated_at
  before update on public.redemptions
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Push and verify**

```bash
npx supabase db push
```

```sql
-- Verify tables and trigger
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('point_ledger', 'rewards', 'redemptions');

select trigger_name, event_object_table
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in ('trg_award_chore_points', 'set_rewards_updated_at', 'set_redemptions_updated_at');
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260703000004_phase_b_store.sql
git commit -m "feat: Phase B store migration — point_ledger, rewards, redemptions, RPCs, triggers"
```

---

### Task 12: Update `undo_chore_completion` for point reversal

**Files:**
- Create: `supabase/migrations/20260703000005_update_undo_completion.sql`

**Critical:** This is where point reversal correctness lives. When a user undoes a chore, the points they earned must be reversed. The reversal must only happen inside `undo_chore_completion` (intentional undo), NOT via a cascade delete trigger, so that archiving a chore does not corrupt history.

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260703000005_update_undo_completion.sql
--
-- Adds point reversal to undo_chore_completion.
-- The deletion of chore_completions in this function is intentional (user action).
-- We insert a chore_completion_reversal row into point_ledger here, not via
-- an AFTER DELETE trigger, so that cascade deletes from archiving a chore
-- do NOT corrupt ledger history.

create or replace function public.undo_chore_completion(
  p_chore_id uuid,
  p_for_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid;
  v_owner    uuid;
  v_house_id uuid;
  v_points   integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select completed_by into v_owner
  from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date
  for update;

  if not found then
    return;  -- already undone, idempotent
  end if;

  if v_owner <> v_caller then
    raise exception 'completion belongs to another user';
  end if;

  -- Look up point value and house for the reversal entry.
  -- If point_value is null (chore predates Phase B), skip reversal gracefully.
  select house_id, point_value into v_house_id, v_points
  from public.chores where id = p_chore_id;

  delete from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date;

  -- Insert reversal only if the point_ledger table exists (Phase B deployed)
  -- and the chore has a point_value.
  if v_points is not null and exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'point_ledger'
  ) then
    insert into public.point_ledger (house_id, user_id, amount, reason, chore_id)
    values (v_house_id, v_caller, -v_points, 'chore_completion_reversal', p_chore_id);
  end if;
end;
$$;
```

- [ ] **Step 2: Push and verify**

```bash
npx supabase db push
```

Manual test in Supabase SQL editor:
1. Complete a chore → verify `point_ledger` gets a positive row.
2. Undo it via `select public.undo_chore_completion('chore-id', 'YYYY-MM-DD')` → verify a negative row is inserted with `reason = 'chore_completion_reversal'`.
3. Archive a chore (set `archived_at`) → verify no spurious `chore_completion_reversal` rows appear.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260703000005_update_undo_completion.sql
git commit -m "feat: update undo_chore_completion to reverse points in point_ledger"
```

---

### Task 13: TypeScript types — Phase B additions

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Add `point_value` to `Chore` interface**

```typescript
export interface Chore {
  // ... existing fields ...
  point_value: number  // add this
  // ...
}
```

- [ ] **Step 2: Add `PointLedger`, `Reward`, `Redemption` types**

```typescript
export interface PointLedger {
  id: string
  house_id: string
  user_id: string
  amount: number
  reason: 'chore_completion' | 'chore_completion_reversal' | 'reward_redemption'
  chore_id: string | null
  reward_id: string | null
  created_at: string
}

export interface Reward {
  id: string
  house_id: string
  created_by: string
  name: string
  emoji: string
  point_cost: number
  requires_approval: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export type RedemptionStatus = 'pending' | 'approved' | 'denied'

export interface Redemption {
  id: string
  house_id: string
  reward_id: string
  user_id: string
  status: RedemptionStatus
  point_cost_at_request: number
  reward_name_snapshot: string
  created_at: string
  updated_at: string
  resolved_at: string | null
  // Joined fields when fetched with profile
  profile?: Profile
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "feat: add PointLedger, Reward, Redemption types; add point_value to Chore"
```

---

### Task 14: `usePointBalance` hook

**Files:**
- Create: `hooks/usePointBalance.ts`

- [ ] **Step 1: Create hook**

```typescript
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export function usePointBalance(houseId: string | undefined): {
  balance: number
  loading: boolean
  refetch: () => Promise<void>
} {
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchBalance = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('get_point_balance', { p_house_id: houseId })
    setBalance(data ?? 0)
    setLoading(false)
  }, [houseId])

  useEffect(() => {
    fetchBalance()
    if (!houseId) return
    // Re-fetch when point_ledger changes for the current user
    const channel = supabase
      .channel(`point_ledger:${houseId}:${Date.now()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'point_ledger',
        filter: `house_id=eq.${houseId}`,
      }, fetchBalance)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetchBalance])

  return { balance, loading, refetch: fetchBalance }
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/usePointBalance.ts
git commit -m "feat: add usePointBalance hook"
```

---

### Task 15: `useRewards` hook

**Files:**
- Create: `hooks/useRewards.ts`

- [ ] **Step 1: Create hook**

```typescript
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Reward } from '@/types/database'

export function useRewards(houseId: string | undefined): {
  rewards: Reward[]
  loading: boolean
  refetch: () => Promise<void>
  addReward: (params: Omit<Reward, 'id' | 'created_at' | 'updated_at' | 'house_id' | 'created_by'>) => Promise<{ error: string | null }>
  updateReward: (id: string, updates: Partial<Pick<Reward, 'name' | 'emoji' | 'point_cost' | 'requires_approval' | 'active'>>) => Promise<{ error: string | null }>
} {
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRewards = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('rewards')
      .select('*')
      .eq('house_id', houseId)
      .eq('active', true)
      .order('created_at', { ascending: false })
    setRewards((data ?? []) as Reward[])
    setLoading(false)
  }, [houseId])

  useEffect(() => {
    fetchRewards()
    if (!houseId) return
    const channel = supabase
      .channel(`rewards:${houseId}:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rewards', filter: `house_id=eq.${houseId}` }, fetchRewards)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetchRewards])

  async function addReward(
    params: Omit<Reward, 'id' | 'created_at' | 'updated_at' | 'house_id' | 'created_by'>
  ): Promise<{ error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !houseId) return { error: 'Not authenticated' }
    const { error } = await supabase.from('rewards').insert({
      ...params,
      house_id: houseId,
      created_by: user.id,
    })
    if (!error) await fetchRewards()
    return { error: error?.message ?? null }
  }

  async function updateReward(
    id: string,
    updates: Partial<Pick<Reward, 'name' | 'emoji' | 'point_cost' | 'requires_approval' | 'active'>>
  ): Promise<{ error: string | null }> {
    const { error } = await supabase.from('rewards').update(updates).eq('id', id)
    if (!error) await fetchRewards()
    return { error: error?.message ?? null }
  }

  return { rewards, loading, refetch: fetchRewards, addReward, updateReward }
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useRewards.ts
git commit -m "feat: add useRewards hook"
```

---

### Task 16: `useRedemptions` hook

**Files:**
- Create: `hooks/useRedemptions.ts`

- [ ] **Step 1: Create hook**

```typescript
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Redemption } from '@/types/database'

export function useRedemptions(houseId: string | undefined, isAdmin: boolean): {
  redemptions: Redemption[]
  pendingCount: number
  loading: boolean
  refetch: () => Promise<void>
  approveRedemption: (id: string) => Promise<{ error: string | null }>
  denyRedemption: (id: string) => Promise<{ error: string | null }>
} {
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRedemptions = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)
    // Admin sees all pending; member sees own history.
    // Must reassign `query` on each `.eq()` call — Supabase builder returns a new object.
    let query = supabase
      .from('redemptions')
      .select('*, profile:profiles!user_id(*)')
      .eq('house_id', houseId)
      .order('created_at', { ascending: false })
    if (!isAdmin) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) query = query.eq('user_id', user.id)
    } else {
      query = query.eq('status', 'pending')
    }
    const { data } = await query
    setRedemptions((data ?? []) as Redemption[])
    setLoading(false)
  }, [houseId, isAdmin])

  useEffect(() => {
    fetchRedemptions()
    if (!houseId) return
    const channel = supabase
      .channel(`redemptions:${houseId}:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redemptions', filter: `house_id=eq.${houseId}` }, fetchRedemptions)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, isAdmin, fetchRedemptions])

  async function approveRedemption(id: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.rpc('approve_redemption', { p_redemption_id: id })
    if (!error && data?.error) return { error: data.error }
    if (!error) await fetchRedemptions()
    return { error: error?.message ?? null }
  }

  async function denyRedemption(id: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.rpc('deny_redemption', { p_redemption_id: id })
    if (!error && data?.error) return { error: data.error }
    if (!error) await fetchRedemptions()
    return { error: error?.message ?? null }
  }

  const pendingCount = redemptions.filter(r => r.status === 'pending').length

  return { redemptions, pendingCount, loading, refetch: fetchRedemptions, approveRedemption, denyRedemption }
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useRedemptions.ts
git commit -m "feat: add useRedemptions hook"
```

---

### Task 17: Add `point_value` to `AddChoreSheet`

**Files:**
- Modify: `components/chores/AddChoreSheet.tsx`

- [ ] **Step 1: Add `pointValue` to `ChoreParams`**

In the `ChoreParams` interface:
```typescript
interface ChoreParams {
  // ... existing fields ...
  pointValue: number   // add this
}
```

- [ ] **Step 2: Add `pointValue` state in the component**

Near other `useState` declarations:
```typescript
const [pointValue, setPointValue] = useState(editingChore?.point_value ?? 10)
```

Add a reset in the `useEffect` that resets form on `editingChore` change:
```typescript
setPointValue(editingChore?.point_value ?? 10)
```

- [ ] **Step 3: Add the `point_value` input to the form JSX**

Below the Notes field and above the days-of-week section, add:
```typescript
<Text style={styles.label}>Points</Text>
<TextInput
  style={styles.input}
  value={String(pointValue)}
  onChangeText={v => setPointValue(Math.max(1, parseInt(v.replace(/[^0-9]/g, '')) || 1))}
  keyboardType="number-pad"
  maxLength={4}
  placeholder="10"
  placeholderTextColor={Colors.onSurfaceVariant}
/>
```

- [ ] **Step 4: Pass `pointValue` in the `onAdd` and `onUpdate` calls**

In `handleSubmit`, include `pointValue` in the `ChoreParams` object passed to `onAdd`. In `onUpdate`, add `pointValue` to the updates patch.

- [ ] **Step 5: Update `useChores.addChore` and `updateChore` to accept and pass `point_value`**

In `hooks/useChores.ts`, add `pointValue: number` to the `addChore` params type and pass `point_value: params.pointValue` in the Supabase insert. Add `pointValue` to `updateChore` updates type and include `point_value` in the patch.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add components/chores/AddChoreSheet.tsx hooks/useChores.ts
git commit -m "feat: add point_value input to AddChoreSheet and useChores"
```

---

### Task 18: Store screen — full implementation

**Files:**
- Modify: `app/(app)/store.tsx`

Replace the Phase A placeholder with the full Store screen. Admin and member see the same tab; role controls what actions are visible.

- [ ] **Step 1: Replace `app/(app)/store.tsx` with full implementation**

```typescript
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, TextInput, Switch, Modal, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { MaterialIcons } from '@expo/vector-icons'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useHouseRole } from '@/hooks/useHouseRole'
import { usePointBalance } from '@/hooks/usePointBalance'
import { useRewards } from '@/hooks/useRewards'
import { useRedemptions } from '@/hooks/useRedemptions'
import { HouseSettingsSheet } from '@/components/house/HouseSettingsSheet'
import { Colors, Fonts, Shadows } from '@/constants/theme'
import { Reward } from '@/types/database'
import { supabase } from '@/lib/supabase'

export default function StoreScreen() {
  const { session, profile } = useAuth()
  const { house, members } = useHouse(session?.user.id)
  const { isAdmin } = useHouseRole(members, session?.user.id)
  const { balance, loading: balanceLoading } = usePointBalance(house?.id)
  const { rewards, loading: rewardsLoading, addReward, updateReward } = useRewards(house?.id)
  const { redemptions, pendingCount, approveRedemption, denyRedemption } = useRedemptions(house?.id, isAdmin)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingReward, setEditingReward] = useState<Reward | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // Add/edit reward form state
  const [draftName, setDraftName] = useState('')
  const [draftEmoji, setDraftEmoji] = useState('🎁')
  const [draftCost, setDraftCost] = useState('50')
  const [draftApproval, setDraftApproval] = useState(false)
  const [saving, setSaving] = useState(false)

  function openAdd() {
    setEditingReward(null)
    setDraftName('')
    setDraftEmoji('🎁')
    setDraftCost('50')
    setDraftApproval(false)
    setAddOpen(true)
  }

  function openEdit(reward: Reward) {
    setEditingReward(reward)
    setDraftName(reward.name)
    setDraftEmoji(reward.emoji)
    setDraftCost(String(reward.point_cost))
    setDraftApproval(reward.requires_approval)
    setAddOpen(true)
  }

  async function handleSaveReward() {
    if (!draftName.trim()) return
    setSaving(true)
    try {
      const cost = Math.max(1, parseInt(draftCost) || 1)
      if (editingReward) {
        const { error } = await updateReward(editingReward.id, {
          name: draftName.trim(),
          emoji: draftEmoji,
          point_cost: cost,
          requires_approval: draftApproval,
        })
        if (error) Alert.alert('Error', error)
        else setAddOpen(false)
      } else {
        const { error } = await addReward({
          name: draftName.trim(),
          emoji: draftEmoji,
          point_cost: cost,
          requires_approval: draftApproval,
          active: true,
        })
        if (error) Alert.alert('Error', error)
        else setAddOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveReward(reward: Reward) {
    Alert.alert(
      'Remove reward?',
      'Members will no longer see this reward. Existing redemptions are unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await updateReward(reward.id, { active: false })
            if (error) Alert.alert('Error', error)
          },
        },
      ]
    )
  }

  async function handleRedeem(reward: Reward) {
    Alert.alert(
      `Redeem ${reward.emoji} ${reward.name}?`,
      `This costs ${reward.point_cost} pts. ${reward.requires_approval ? 'Requires admin approval.' : 'Instant redemption.'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Spend ${reward.point_cost} pts`,
          onPress: async () => {
            const { data, error } = await supabase.rpc('redeem_reward', { p_reward_id: reward.id })
            if (error) { Alert.alert('Error', error.message); return }
            if (data?.error === 'insufficient_points') {
              Alert.alert('Not enough points', `You need ${reward.point_cost} pts but only have ${balance}.`)
              return
            }
            if (data?.status === 'pending') {
              Alert.alert('Request sent! 🙏', 'Waiting for admin approval.')
            } else {
              Alert.alert('Redeemed! 🎉', `Enjoy: ${reward.name}`)
            }
          },
        },
      ]
    )
  }

  if (!house) return <ActivityIndicator style={{ flex: 1 }} color={Colors.primary} />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Store</Text>
          <Text style={styles.headerSub}>{isAdmin ? 'Manage rewards' : 'Spend your points'}</Text>
        </View>
        <View style={styles.headerRight}>
          {!balanceLoading && (
            <View style={styles.balanceChip}>
              <Text style={styles.balanceText}>🪙 {balance} pts</Text>
            </View>
          )}
          <TouchableOpacity onPress={() => setSettingsOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <MaterialIcons name="settings" size={24} color={Colors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Admin: pending approvals */}
        {isAdmin && pendingCount > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending approvals ({pendingCount})</Text>
            <View style={styles.card}>
              {redemptions.filter(r => r.status === 'pending').map((r, idx) => (
                <View key={r.id} style={[styles.pendingRow, idx > 0 && styles.rowBorder]}>
                  <View style={styles.pendingInfo}>
                    <Text style={styles.pendingName}>{r.profile?.display_name ?? 'Member'}</Text>
                    <Text style={styles.pendingReward}>{r.reward_name_snapshot} · {r.point_cost_at_request} pts</Text>
                  </View>
                  <View style={styles.pendingActions}>
                    <TouchableOpacity
                      style={styles.approveBtn}
                      onPress={async () => {
                        const { error } = await approveRedemption(r.id)
                        if (error) Alert.alert('Error', error)
                      }}
                    >
                      <Text style={styles.approveBtnText}>✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.denyBtn}
                      onPress={async () => {
                        const { error } = await denyRedemption(r.id)
                        if (error) Alert.alert('Error', error)
                      }}
                    >
                      <Text style={styles.denyBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Rewards list */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Rewards</Text>
            {isAdmin && (
              <TouchableOpacity onPress={openAdd} style={styles.addBtn} activeOpacity={0.8}>
                <Text style={styles.addBtnText}>+ Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {rewardsLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : rewards.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>
                {isAdmin ? 'No rewards yet. Add one above.' : 'No rewards yet. Ask an admin to add some!'}
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              {rewards.map((reward, idx) => (
                <View key={reward.id} style={[styles.rewardRow, idx > 0 && styles.rowBorder]}>
                  <Text style={styles.rewardEmoji}>{reward.emoji}</Text>
                  <View style={styles.rewardInfo}>
                    <Text style={styles.rewardName}>{reward.name}</Text>
                    {reward.requires_approval && (
                      <Text style={styles.approvalBadge}>Needs approval</Text>
                    )}
                  </View>
                  {isAdmin ? (
                    <View style={styles.rewardAdminActions}>
                      <Text style={styles.costText}>{reward.point_cost} pts</Text>
                      <TouchableOpacity onPress={() => openEdit(reward)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="edit" size={18} color={Colors.onSurfaceVariant} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleArchiveReward(reward)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="delete-outline" size={18} color={Colors.error} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.redeemBtn, balance < reward.point_cost && styles.redeemBtnDisabled]}
                      onPress={() => handleRedeem(reward)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.redeemBtnText}>{reward.point_cost} pts</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

      </ScrollView>

      {/* Add/Edit reward sheet */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>{editingReward ? 'Edit reward' : 'Add reward'}</Text>

            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="e.g. Stay up late"
              placeholderTextColor={Colors.onSurfaceVariant}
              autoCapitalize="sentences"
            />

            <Text style={styles.inputLabel}>Emoji</Text>
            <TextInput
              style={styles.input}
              value={draftEmoji}
              onChangeText={setDraftEmoji}
              placeholder="🎁"
              maxLength={4}
            />

            <Text style={styles.inputLabel}>Point cost</Text>
            <TextInput
              style={styles.input}
              value={draftCost}
              onChangeText={v => setDraftCost(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="50"
              maxLength={5}
            />

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Requires approval</Text>
              <Switch value={draftApproval} onValueChange={setDraftApproval} />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, (!draftName.trim() || saving) && { opacity: 0.4 }]}
              onPress={handleSaveReward}
              disabled={!draftName.trim() || saving}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save reward'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAddOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <HouseSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    ...Shadows.card,
  },
  headerTitle: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.primary },
  headerSub: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  balanceChip: { backgroundColor: Colors.secondaryContainer, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  balanceText: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.onSecondaryContainer },

  content: { padding: 20, gap: 24, paddingBottom: 100 },

  section: { gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.onSurface },
  addBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
  addBtnText: { fontSize: 13, fontFamily: Fonts.bold, color: '#fff' },

  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    ...Shadows.card,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  emptyText: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, textAlign: 'center' },

  pendingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  pendingInfo: { flex: 1 },
  pendingName: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurface },
  pendingReward: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  pendingActions: { flexDirection: 'row', gap: 8 },
  approveBtn: { backgroundColor: Colors.primary, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  approveBtnText: { color: '#fff', fontFamily: Fonts.bold, fontSize: 14 },
  denyBtn: { backgroundColor: Colors.errorContainer, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  denyBtnText: { color: Colors.error, fontFamily: Fonts.bold, fontSize: 14 },

  rewardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rewardEmoji: { fontSize: 28 },
  rewardInfo: { flex: 1 },
  rewardName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  approvalBadge: { fontSize: 11, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, marginTop: 2 },
  rewardAdminActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  costText: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.primary },
  redeemBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  redeemBtnDisabled: { opacity: 0.4 },
  redeemBtnText: { fontSize: 13, fontFamily: Fonts.bold, color: '#fff' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 48, gap: 4 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 8 },
  inputLabel: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.outline, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: Fonts.semibold,
    color: Colors.onSurface,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  toggleLabel: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnText: { fontSize: 15, fontFamily: Fonts.bold, color: '#fff' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Fix all errors before continuing.

- [ ] **Step 3: Manual golden-path test (admin)**

1. Open Store tab — empty rewards list, pending approvals section hidden.
2. Tap "+ Add" → fill in name/emoji/cost/approval → save → reward appears.
3. Tap Edit → change cost → save → cost updates.
4. Tap delete icon → confirm → reward disappears.
5. Add a reward with "requires approval = false". Sign in as member → tap reward → confirm → sees "Redeemed! 🎉" toast.
6. Admin sees no pending approval for instant rewards.
7. Add an approval-required reward. Member redeems → sees "Waiting for admin approval". Admin sees pending row → tap ✓ → row disappears, member balance decreases.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/store.tsx
git commit -m "feat: full Store screen — admin reward CRUD, member browse + redeem, pending approvals"
```

---

### Task 19: Phase B smoke test + OTA push

- [ ] **Step 1: Complete a chore and verify points are awarded**

In Supabase SQL editor:
```sql
select * from public.point_ledger order by created_at desc limit 5;
```
Expected: row with `reason = 'chore_completion'` and positive `amount`.

- [ ] **Step 2: Undo the chore and verify reversal**

In the app, undo the completion. Then:
```sql
select * from public.point_ledger order by created_at desc limit 5;
```
Expected: new row with `reason = 'chore_completion_reversal'` and negative `amount`. Net balance should be 0.

- [ ] **Step 3: Archive a chore and verify NO reversal row appears**

In Supabase dashboard, find a chore with completions and set `archived_at = now()`. Check `point_ledger`:
```sql
select * from public.point_ledger order by created_at desc limit 5;
```
Expected: no new `chore_completion_reversal` rows from the archive.

- [ ] **Step 4: OTA push**

```bash
eas update --branch production --environment production --message "Phase B: point ledger, reward store, earn/spend points"
```
