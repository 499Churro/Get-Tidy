import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

const PROFILES_KEY = 'tidy:device_profiles'
const PRIMARY_TOKEN_KEY = 'tidy:primary_refresh_token'

export interface DeviceProfile {
  userId: string
  email: string
  password: string
  displayName: string
  avatarColorIndex: number
  avatarUrl: string | null
  pin: string | null
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
    const token = await getPrimaryRefreshToken()
    if (!token) return { error: 'Primary session expired. Please sign in again.' }
    const { error, data } = await supabase.auth.refreshSession({ refresh_token: token })
    if (!error && data.session?.refresh_token) {
      await savePrimaryRefreshToken(data.session.refresh_token)
    }
    return { error: error?.message ?? null }
  }
}
