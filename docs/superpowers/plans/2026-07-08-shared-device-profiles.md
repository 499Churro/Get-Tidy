# Shared Device Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to create managed local profiles so multiple family members can share one device, each checking off their own chores under their own identity.

**Architecture:** Managed profiles are real Supabase auth users (email `managed-[uuid]@tidy.local`, auto-generated password). An Edge Function uses the service-role key to create them server-side so the admin's session is never disturbed. Profile metadata + credentials are stored in AsyncStorage. Switching profiles calls `supabase.auth.signInWithPassword` (managed) or `supabase.auth.refreshSession` (primary). The existing `onAuthStateChange` listener in `useAuth.ts` handles all re-renders automatically when the session changes.

**Key design decisions:**
- Managed profiles have optional PIN (stored plain text — family app, not a vault)
- Profile switcher opens from the avatar in the Home screen header
- Push notifications stay device-level; managed profiles do not get their own push token
- Deleting a managed profile also deletes their Supabase auth user (cascades to house_members, profiles, point_ledger, etc.)

**Tech Stack:** React Native (Expo), Supabase Edge Functions (Deno), AsyncStorage, expo-router, TypeScript.

---

## File Map

| File | Action | What it does |
|------|--------|-------------|
| `supabase/functions/create-managed-profile/index.ts` | Create | Edge Function: creates Supabase auth user + profile row + house_members row using service-role key |
| `supabase/functions/delete-managed-profile/index.ts` | Create | Edge Function: deletes a managed auth user by ID (admin-only, verifies target is managed) |
| `lib/deviceProfiles.ts` | Create | AsyncStorage CRUD for device profiles; session-switching logic |
| `components/profiles/ProfileSwitcherSheet.tsx` | Create | Modal showing all profiles on device; handles tap-to-switch and PIN entry |
| `components/profiles/CreateManagedProfileSheet.tsx` | Create | Admin form to create a managed profile (name, color, optional PIN) |
| `components/house/HouseSettingsSheet.tsx` | Modify | Add "Device Profiles" section (admin only) listing managed profiles with remove button |
| `app/(app)/index.tsx` | Modify | Make the profile avatar in the header tappable → opens ProfileSwitcherSheet |

---

## Task 1: Edge Function — `create-managed-profile`

**Files:**
- Create: `supabase/functions/create-managed-profile/index.ts`

The function:
1. Reads the caller's JWT to verify they are an admin of the given `house_id`
2. Generates a unique email `managed-[randomId]@tidy.local`
3. Creates a Supabase auth user with `email_confirm: true`
4. Upserts a row in `public.profiles` with `display_name` and `avatar_color_index`
5. Inserts a row in `public.house_members` with `role = 'member'`
6. Returns `{ userId, email }` or `{ error }`

- [ ] **Step 1: Create the function file**

```typescript
// supabase/functions/create-managed-profile/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller via their JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { name, avatarColorIndex, houseId, password } = await req.json()
    if (!name || !houseId || !password) {
      return new Response(JSON.stringify({ error: 'name, houseId, and password are required' }), { status: 400, headers: corsHeaders })
    }

    // Verify caller is admin of the house
    const { data: membership } = await adminClient
      .from('house_members')
      .select('role')
      .eq('house_id', houseId)
      .eq('user_id', caller.id)
      .single()
    if (membership?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can create managed profiles' }), { status: 403, headers: corsHeaders })
    }

    // Generate unique managed email
    const uniqueId = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    const email = `managed-${uniqueId}@tidy.local`

    // Create auth user
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    })
    if (createErr || !newUser.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? 'Failed to create user' }), { status: 500, headers: corsHeaders })
    }

    const userId = newUser.user.id

    // Upsert profile
    await adminClient.from('profiles').upsert({
      id: userId,
      display_name: name,
      avatar_color_index: avatarColorIndex ?? 0,
      timezone: 'America/Los_Angeles',
    })

    // Add to house
    await adminClient.from('house_members').insert({
      house_id: houseId,
      user_id: userId,
      role: 'member',
    })

    return new Response(JSON.stringify({ userId, email }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
```

- [ ] **Step 2: Deploy the function**

```bash
npx supabase functions deploy create-managed-profile --no-verify-jwt
```

Wait — we DO want JWT verification (we read the caller's JWT ourselves). Use:
```bash
npx supabase functions deploy create-managed-profile
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-managed-profile/
git commit -m "feat: Edge Function — create-managed-profile for shared device support"
```

---

## Task 2: Edge Function — `delete-managed-profile`

**Files:**
- Create: `supabase/functions/delete-managed-profile/index.ts`

- [ ] **Step 1: Create the function file**

```typescript
// supabase/functions/delete-managed-profile/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { targetUserId } = await req.json()
    if (!targetUserId) return new Response(JSON.stringify({ error: 'targetUserId required' }), { status: 400, headers: corsHeaders })

    // Verify target is a managed profile (email ends in @tidy.local)
    const { data: targetUser } = await adminClient.auth.admin.getUserById(targetUserId)
    if (!targetUser?.user?.email?.endsWith('@tidy.local')) {
      return new Response(JSON.stringify({ error: 'Target is not a managed profile' }), { status: 400, headers: corsHeaders })
    }

    // Verify caller is admin of the same house as the target
    const { data: targetMembership } = await adminClient
      .from('house_members')
      .select('house_id')
      .eq('user_id', targetUserId)
      .single()
    if (!targetMembership) return new Response(JSON.stringify({ error: 'Target not in any house' }), { status: 404, headers: corsHeaders })

    const { data: callerMembership } = await adminClient
      .from('house_members')
      .select('role')
      .eq('house_id', targetMembership.house_id)
      .eq('user_id', caller.id)
      .single()
    if (callerMembership?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can remove managed profiles' }), { status: 403, headers: corsHeaders })
    }

    // Delete the auth user — cascades to profiles + house_members
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(targetUserId)
    if (deleteErr) return new Response(JSON.stringify({ error: deleteErr.message }), { status: 500, headers: corsHeaders })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy delete-managed-profile
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/delete-managed-profile/
git commit -m "feat: Edge Function — delete-managed-profile"
```

---

## Task 3: `lib/deviceProfiles.ts`

**Files:**
- Create: `lib/deviceProfiles.ts`

- [ ] **Step 1: Create the file**

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

const PROFILES_KEY = 'tidy:device_profiles'
const PRIMARY_TOKEN_KEY = 'tidy:primary_refresh_token'

export interface DeviceProfile {
  userId: string
  email: string       // @tidy.local for managed; real email (display only) for primary
  password: string    // only meaningful for managed profiles
  displayName: string
  avatarColorIndex: number
  avatarUrl: string | null
  pin: string | null  // 4-digit string or null
  isManaged: boolean
  houseId: string
}

export async function getDeviceProfiles(): Promise<DeviceProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(PROFILES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function addDeviceProfile(profile: DeviceProfile): Promise<void> {
  const profiles = await getDeviceProfiles()
  const existing = profiles.findIndex(p => p.userId === profile.userId)
  if (existing >= 0) profiles[existing] = profile
  else profiles.push(profile)
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
}

export async function removeDeviceProfile(userId: string): Promise<void> {
  const profiles = await getDeviceProfiles()
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles.filter(p => p.userId !== userId)))
}

export async function updateDeviceProfile(userId: string, updates: Partial<DeviceProfile>): Promise<void> {
  const profiles = await getDeviceProfiles()
  const idx = profiles.findIndex(p => p.userId === userId)
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...updates }
    await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
  }
}

export async function savePrimaryRefreshToken(token: string): Promise<void> {
  await AsyncStorage.setItem(PRIMARY_TOKEN_KEY, token)
}

export async function getPrimaryRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(PRIMARY_TOKEN_KEY)
}

export function generateManagedPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%'
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// Call before switching AWAY from the primary account to preserve their session.
export async function capturePrimarySession(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session?.refresh_token) {
    await savePrimaryRefreshToken(data.session.refresh_token)
  }
}

export async function switchToProfile(
  profile: DeviceProfile
): Promise<{ error: string | null }> {
  if (profile.isManaged) {
    const { error } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: profile.password,
    })
    return { error: error?.message ?? null }
  } else {
    // Switching back to primary — use stored refresh token
    const token = await getPrimaryRefreshToken()
    if (!token) return { error: 'Primary session expired. Please sign in again.' }
    const { error } = await supabase.auth.refreshSession({ refresh_token: token })
    if (!error) {
      // Save the new refresh token (rolling window)
      const { data } = await supabase.auth.getSession()
      if (data.session?.refresh_token) await savePrimaryRefreshToken(data.session.refresh_token)
    }
    return { error: error?.message ?? null }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add lib/deviceProfiles.ts
git commit -m "feat: deviceProfiles lib — AsyncStorage CRUD and session switching for shared device"
```

---

## Task 4: `components/profiles/ProfileSwitcherSheet.tsx`

**Files:**
- Create: `components/profiles/ProfileSwitcherSheet.tsx`

This is a `Modal` (same slide-up pattern as other modals in the app). It shows all profiles stored on this device. The current user is highlighted with a checkmark. Tapping another profile switches to it (with a PIN prompt if the profile has a PIN set). An "Add profile" button at the bottom is shown only to admins.

- [ ] **Step 1: Create the component**

```tsx
import { View, Text, TouchableOpacity, StyleSheet, Modal, Alert, TextInput, ActivityIndicator } from 'react-native'
import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useHouseRole } from '@/hooks/useHouseRole'
import { Avatar } from '@/components/ui/Avatar'
import { Colors, Fonts, AvatarGradients } from '@/constants/theme'
import { LinearGradient } from 'expo-linear-gradient'
import {
  getDeviceProfiles,
  capturePrimarySession,
  switchToProfile,
  DeviceProfile,
} from '@/lib/deviceProfiles'

interface ProfileSwitcherSheetProps {
  visible: boolean
  onClose: () => void
  onAddProfile: () => void  // opens CreateManagedProfileSheet
}

export function ProfileSwitcherSheet({ visible, onClose, onAddProfile }: ProfileSwitcherSheetProps) {
  const { session, profile } = useAuth()
  const { house, members } = useHouse(session?.user.id)
  const { isAdmin } = useHouseRole(members, session?.user.id)

  const [profiles, setProfiles] = useState<DeviceProfile[]>([])
  const [pinTarget, setPinTarget] = useState<DeviceProfile | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    if (visible) {
      getDeviceProfiles().then(setProfiles)
    }
  }, [visible])

  async function handleSelectProfile(target: DeviceProfile) {
    if (target.userId === session?.user.id) { onClose(); return }
    if (target.pin) {
      setPinTarget(target)
      setPinInput('')
      return
    }
    await doSwitch(target)
  }

  async function doSwitch(target: DeviceProfile) {
    setSwitching(true)
    // If currently on primary, save their session first
    if (!isCurrentUserManaged()) {
      await capturePrimarySession()
    }
    const { error } = await switchToProfile(target)
    setSwitching(false)
    if (error) {
      Alert.alert('Could not switch', error)
    } else {
      onClose()
    }
  }

  function isCurrentUserManaged(): boolean {
    return session?.user.email?.endsWith('@tidy.local') ?? false
  }

  async function handlePinSubmit() {
    if (!pinTarget) return
    if (pinInput !== pinTarget.pin) {
      Alert.alert('Wrong PIN', 'Try again.')
      setPinInput('')
      return
    }
    setPinTarget(null)
    await doSwitch(pinTarget)
  }

  const currentUserId = session?.user.id

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Switch profile</Text>

            <View style={styles.profileList}>
              {profiles.map((p) => {
                const isCurrent = p.userId === currentUserId
                const grad = AvatarGradients[p.avatarColorIndex % AvatarGradients.length]
                return (
                  <TouchableOpacity
                    key={p.userId}
                    style={[styles.profileRow, isCurrent && styles.profileRowActive]}
                    onPress={() => handleSelectProfile(p)}
                    activeOpacity={0.7}
                    disabled={switching}
                  >
                    <Avatar
                      uri={p.avatarUrl}
                      displayName={p.displayName}
                      colorIndex={p.avatarColorIndex}
                      size={48}
                    />
                    <View style={styles.profileInfo}>
                      <Text style={styles.profileName}>{p.displayName}{isCurrent ? ' (you)' : ''}</Text>
                      {p.pin ? <Text style={styles.pinHint}>🔒 PIN protected</Text> : null}
                    </View>
                    {isCurrent && (
                      <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.checkBadge}>
                        <Text style={styles.checkMark}>✓</Text>
                      </LinearGradient>
                    )}
                  </TouchableOpacity>
                )
              })}

              {profiles.length === 0 && (
                <Text style={styles.emptyText}>No profiles set up yet.</Text>
              )}
            </View>

            {isAdmin && (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => { onClose(); onAddProfile() }}
                activeOpacity={0.8}
              >
                <Text style={styles.addBtnText}>+ Add profile</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            {switching && (
              <View style={styles.switchingOverlay}>
                <ActivityIndicator color={Colors.primary} size="large" />
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* PIN entry modal */}
      <Modal visible={!!pinTarget} transparent animationType="fade" onRequestClose={() => setPinTarget(null)}>
        <View style={styles.pinOverlay}>
          <View style={styles.pinCard}>
            <Text style={styles.pinTitle}>Enter PIN for {pinTarget?.displayName}</Text>
            <TextInput
              style={styles.pinInput}
              value={pinInput}
              onChangeText={setPinInput}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              placeholder="••••"
              placeholderTextColor={Colors.outline}
            />
            <TouchableOpacity
              style={[styles.pinSubmit, pinInput.length < 1 && { opacity: 0.4 }]}
              onPress={handlePinSubmit}
              disabled={pinInput.length < 1}
              activeOpacity={0.8}
            >
              <Text style={styles.pinSubmitText}>Unlock</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPinTarget(null)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
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
    maxHeight: '80%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginVertical: 12 },
  title: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 16 },

  profileList: { gap: 4, marginBottom: 20 },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  profileRowActive: { backgroundColor: Colors.surfaceContainerLow },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  pinHint: { fontSize: 11, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, marginTop: 2 },
  checkBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontSize: 14, fontFamily: Fonts.bold },
  emptyText: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 16 },

  addBtn: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  addBtnText: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.primary },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },

  switchingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
  },

  // PIN modal
  pinOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  pinCard: { backgroundColor: Colors.surface, borderRadius: 24, padding: 24, width: '100%', gap: 12 },
  pinTitle: { fontSize: 17, fontFamily: Fonts.bold, color: Colors.onSurface, textAlign: 'center', marginBottom: 8 },
  pinInput: {
    fontSize: 32,
    fontFamily: Fonts.bold,
    letterSpacing: 12,
    textAlign: 'center',
    color: Colors.onSurface,
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
    paddingVertical: 12,
  },
  pinSubmit: { backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  pinSubmitText: { fontSize: 15, fontFamily: Fonts.bold, color: '#fff' },
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add components/profiles/ProfileSwitcherSheet.tsx
git commit -m "feat: ProfileSwitcherSheet — tap to switch profiles with optional PIN"
```

---

## Task 5: `components/profiles/CreateManagedProfileSheet.tsx`

**Files:**
- Create: `components/profiles/CreateManagedProfileSheet.tsx`

Admin form to create a managed profile. On submit: generates a password, saves the primary refresh token, calls the Edge Function, then adds the profile to local AsyncStorage.

- [ ] **Step 1: Create the component**

```tsx
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Alert, Switch, ActivityIndicator, ScrollView } from 'react-native'
import { useState } from 'react'
import { LinearGradient } from 'expo-linear-gradient'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { Colors, Fonts, AvatarGradients } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import {
  addDeviceProfile,
  capturePrimarySession,
  generateManagedPassword,
} from '@/lib/deviceProfiles'

interface CreateManagedProfileSheetProps {
  visible: boolean
  onClose: () => void
  onCreated: () => void
}

export function CreateManagedProfileSheet({ visible, onClose, onCreated }: CreateManagedProfileSheetProps) {
  const { session } = useAuth()
  const { house } = useHouse(session?.user.id)

  const [name, setName] = useState('')
  const [colorIndex, setColorIndex] = useState(0)
  const [pinEnabled, setPinEnabled] = useState(false)
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setName('')
    setColorIndex(0)
    setPinEnabled(false)
    setPin('')
  }

  async function handleCreate() {
    if (!name.trim() || !house || !session) return
    if (pinEnabled && pin.length < 4) {
      Alert.alert('PIN too short', 'PIN must be at least 4 digits.')
      return
    }

    setSaving(true)
    try {
      // Save primary session before creating (so we can restore later)
      await capturePrimarySession()

      const password = generateManagedPassword()

      // Call Edge Function
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) { Alert.alert('Error', 'Not signed in'); return }

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/create-managed-profile`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({
            name: name.trim(),
            avatarColorIndex: colorIndex,
            houseId: house.id,
            password,
          }),
        }
      )
      const result = await response.json()
      if (!response.ok || result.error) {
        Alert.alert('Error', result.error ?? 'Failed to create profile')
        return
      }

      // Save to local device storage
      await addDeviceProfile({
        userId: result.userId,
        email: result.email,
        password,
        displayName: name.trim(),
        avatarColorIndex: colorIndex,
        avatarUrl: null,
        pin: pinEnabled && pin ? pin : null,
        isManaged: true,
        houseId: house.id,
      })

      reset()
      onCreated()
      onClose()
    } catch (e) {
      Alert.alert('Error', String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Add profile</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Mom, Jake, Lily..."
              placeholderTextColor={Colors.onSurfaceVariant}
              autoCapitalize="words"
              autoFocus
            />

            <Text style={styles.label}>Color</Text>
            <View style={styles.colorGrid}>
              {AvatarGradients.map(([start, end], idx) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setColorIndex(idx)}
                  style={styles.colorSwatch}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[start, end]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.colorSwatchGrad, colorIndex === idx && styles.colorSwatchSelected]}
                  />
                  {colorIndex === idx && <Text style={styles.colorCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>PIN protection</Text>
                <Text style={styles.toggleHint}>Prevent others from switching to this profile</Text>
              </View>
              <Switch value={pinEnabled} onValueChange={setPinEnabled} />
            </View>

            {pinEnabled && (
              <>
                <Text style={styles.label}>PIN (4 digits)</Text>
                <TextInput
                  style={styles.input}
                  value={pin}
                  onChangeText={v => setPin(v.replace(/[^0-9]/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  secureTextEntry
                  placeholder="••••"
                  placeholderTextColor={Colors.outline}
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.createBtn, (!name.trim() || saving) && { opacity: 0.4 }]}
              onPress={handleCreate}
              disabled={!name.trim() || saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.createBtnText}>Create profile</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
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
    maxHeight: '88%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginVertical: 12 },
  title: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 16 },

  label: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.outline, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
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

  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4, marginBottom: 8 },
  colorSwatch: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  colorSwatchGrad: { width: 44, height: 44, borderRadius: 22, position: 'absolute' },
  colorSwatchSelected: { width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: Colors.onSurface },
  colorCheck: { fontSize: 18, color: '#fff', fontFamily: Fonts.bold },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  toggleLabel: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  toggleHint: { fontSize: 12, fontFamily: Fonts.regular, color: Colors.onSurfaceVariant, marginTop: 2 },

  createBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  createBtnText: { fontSize: 15, fontFamily: Fonts.bold, color: '#fff' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add components/profiles/CreateManagedProfileSheet.tsx
git commit -m "feat: CreateManagedProfileSheet — admin form to add shared device profiles"
```

---

## Task 6: Update `HouseSettingsSheet` — Device Profiles section

**Files:**
- Modify: `components/house/HouseSettingsSheet.tsx`

Add a "Device Profiles" section (admin-only) that:
- Lists managed profiles stored on this device for the current house
- Has a "Remove" button per profile that calls the `delete-managed-profile` Edge Function and removes from AsyncStorage
- Has a "Add profile" button to open `CreateManagedProfileSheet`

- [ ] **Step 1: Add Device Profiles section**

At the top of `HouseSettingsSheet.tsx`, add imports:
```tsx
import { getDeviceProfiles, removeDeviceProfile, DeviceProfile } from '@/lib/deviceProfiles'
import { CreateManagedProfileSheet } from '@/components/profiles/CreateManagedProfileSheet'
```

Add state near the top of the component:
```tsx
const [managedProfiles, setManagedProfiles] = useState<DeviceProfile[]>([])
const [createProfileOpen, setCreateProfileOpen] = useState(false)
```

Load managed profiles when the sheet opens. Add a `useEffect` that runs when `visible` changes to `true`:
```tsx
useEffect(() => {
  if (visible && house) {
    getDeviceProfiles().then(all =>
      setManagedProfiles(all.filter(p => p.isManaged && p.houseId === house.id))
    )
  }
}, [visible, house])
```

Add a `handleRemoveProfile` function:
```tsx
async function handleRemoveProfile(profile: DeviceProfile) {
  Alert.alert(
    'Remove profile?',
    `${profile.displayName}'s profile will be deleted from this device and the house.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { data: sessionData } = await supabase.auth.getSession()
          const accessToken = sessionData.session?.access_token
          if (!accessToken) return
          const response = await fetch(
            `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-managed-profile`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
              },
              body: JSON.stringify({ targetUserId: profile.userId }),
            }
          )
          const result = await response.json()
          if (!response.ok || result.error) {
            Alert.alert('Error', result.error ?? 'Failed to remove profile')
            return
          }
          await removeDeviceProfile(profile.userId)
          setManagedProfiles(prev => prev.filter(p => p.userId !== profile.userId))
          refetchHouse()
        },
      },
    ]
  )
}
```

Add the Device Profiles section in the JSX, **before** the Members section (after the chore rotation section):

```tsx
{isAdmin && (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>Device profiles</Text>
    <View style={styles.card}>
      <Text style={styles.notifHint}>
        Add profiles so family members can share this device and check off their own tasks.
      </Text>
      {managedProfiles.length > 0 && (
        <>
          <View style={styles.divider} />
          {managedProfiles.map((p, idx) => (
            <View key={p.userId} style={[styles.memberRow, idx > 0 && styles.memberRowBorder]}>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{p.displayName}</Text>
                {p.pin ? <Text style={styles.memberStatus}>PIN protected</Text> : null}
              </View>
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => handleRemoveProfile(p)}
              >
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
      <View style={styles.divider} />
      <TouchableOpacity onPress={() => setCreateProfileOpen(true)} activeOpacity={0.7}>
        <Text style={styles.linkText}>+ Add profile</Text>
      </TouchableOpacity>
    </View>
  </View>
)}
```

Add the `CreateManagedProfileSheet` just before the closing `</Modal>` tag of the main settings modal:
```tsx
<CreateManagedProfileSheet
  visible={createProfileOpen}
  onClose={() => setCreateProfileOpen(false)}
  onCreated={() => {
    if (house) {
      getDeviceProfiles().then(all =>
        setManagedProfiles(all.filter(p => p.isManaged && p.houseId === house.id))
      )
    }
  }}
/>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Fix any errors.

- [ ] **Step 3: Commit**

```bash
git add components/house/HouseSettingsSheet.tsx
git commit -m "feat: add Device Profiles section to HouseSettingsSheet"
```

---

## Task 7: Home screen — tappable avatar opens ProfileSwitcherSheet

**Files:**
- Modify: `app/(app)/index.tsx`

The home screen header currently has a `TidyLogo` on the left and a settings gear on the right. We need to add a tappable avatar/profile button that opens `ProfileSwitcherSheet`.

- [ ] **Step 1: Read the current header JSX in `app/(app)/index.tsx`**

Search for the header section — it's around line 200-250 (after all the state declarations). Find the `View` with `styles.header` or wherever `TidyLogo` and the greeting live.

- [ ] **Step 2: Add imports**

Add to the imports at the top:
```tsx
import { ProfileSwitcherSheet } from '@/components/profiles/ProfileSwitcherSheet'
import { CreateManagedProfileSheet } from '@/components/profiles/CreateManagedProfileSheet'
import { Avatar } from '@/components/ui/Avatar'
```

- [ ] **Step 3: Add state**

Near the other `useState` calls:
```tsx
const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false)
const [createProfileOpen, setCreateProfileOpen] = useState(false)
```

- [ ] **Step 4: Add tappable avatar to the header**

Find the header JSX (the `<View style={styles.header}>` section). Add a tappable avatar on the left side that shows the current user's avatar. Wrap the existing left section in a `TouchableOpacity`:

```tsx
<TouchableOpacity
  onPress={() => setProfileSwitcherOpen(true)}
  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
  activeOpacity={0.7}
>
  <Avatar
    uri={profile?.avatar_url ?? null}
    displayName={profile?.display_name ?? '?'}
    colorIndex={profile?.avatar_color_index ?? 0}
    size={36}
  />
</TouchableOpacity>
```

Place this in the header row, on the left side alongside the greeting/logo.

- [ ] **Step 5: Add the sheets before the closing `</SafeAreaView>`**

```tsx
<ProfileSwitcherSheet
  visible={profileSwitcherOpen}
  onClose={() => setProfileSwitcherOpen(false)}
  onAddProfile={() => {
    setProfileSwitcherOpen(false)
    setCreateProfileOpen(true)
  }}
/>
<CreateManagedProfileSheet
  visible={createProfileOpen}
  onClose={() => setCreateProfileOpen(false)}
  onCreated={() => setProfileSwitcherOpen(true)}
/>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/index.tsx
git commit -m "feat: tap avatar on home screen to open profile switcher"
```

---

## Task 8: Also register the primary user in device profiles on first use

**Files:**
- Modify: `hooks/useAuth.ts`

When a non-managed user signs in (email doesn't end in `@tidy.local`), we should make sure they are in the device profiles list so the switcher can show them. Also save their refresh token.

- [ ] **Step 1: Add to useAuth.ts**

In `useAuth.ts`, add import:
```typescript
import { addDeviceProfile, savePrimaryRefreshToken, getDeviceProfiles } from '@/lib/deviceProfiles'
```

In `loadProfile`, after successfully loading the profile, check if this is a primary (non-managed) user and register them in device profiles if not already there:
```typescript
async function loadProfile(s: Session) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', s.user.id)
    .single()
  if (data) {
    setProfile(data)
    AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data)).catch(() => {})

    // Register in device profiles if this is a primary (non-managed) account
    const isManaged = s.user.email?.endsWith('@tidy.local') ?? false
    if (!isManaged && s.refresh_token) {
      savePrimaryRefreshToken(s.refresh_token).catch(() => {})
      // Register primary user in device profiles list (for the switcher)
      const existing = await getDeviceProfiles()
      const alreadyThere = existing.some(p => p.userId === s.user.id)
      if (!alreadyThere) {
        // Get house membership to find houseId
        const { data: membership } = await supabase
          .from('house_members')
          .select('house_id')
          .eq('user_id', s.user.id)
          .limit(1)
          .single()
        if (membership) {
          addDeviceProfile({
            userId: s.user.id,
            email: s.user.email ?? '',
            password: '',  // not stored for primary accounts
            displayName: data.display_name,
            avatarColorIndex: data.avatar_color_index,
            avatarUrl: data.avatar_url,
            pin: null,
            isManaged: false,
            houseId: membership.house_id,
          }).catch(() => {})
        }
      } else {
        // Update display info in case it changed (name/avatar change)
        const { updateDeviceProfile } = await import('@/lib/deviceProfiles')
        updateDeviceProfile(s.user.id, {
          displayName: data.display_name,
          avatarColorIndex: data.avatar_color_index,
          avatarUrl: data.avatar_url,
        }).catch(() => {})
      }
    }
  }
  setLoading(false)
}
```

Note: `Session` has a `refresh_token` property. Import the `Session` type check — if `s.refresh_token` is undefined at this point, also call `supabase.auth.getSession()` to get a fresh session object with the token.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add hooks/useAuth.ts
git commit -m "feat: auto-register primary user in device profiles on sign-in"
```

---

## Task 9: Deploy Edge Functions + OTA push

- [ ] **Step 1: Verify both Edge Functions are deployed**

```bash
npx supabase functions list
```

Both `create-managed-profile` and `delete-managed-profile` should appear.

- [ ] **Step 2: Final TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Zero errors expected.

- [ ] **Step 3: OTA push**

```bash
eas update --branch production --environment production --message "feat: shared device profiles — admins can add family member profiles for shared tablet use"
```

Report DONE with the EAS update ID.
