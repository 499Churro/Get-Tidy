import { createContext, useContext, useEffect, useState, ReactNode, createElement } from 'react'
import { Session } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { Profile } from '@/types/database'

const PROFILE_CACHE_KEY = 'tidy:cached_profile'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  updateProfile: (updates: { display_name?: string; avatar_color_index?: number; avatar_url?: string }, opts?: { applyImmediately?: boolean }) => Promise<{ error: string | null; apply: () => void }>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  updateProfile: async () => ({ error: 'AuthProvider not mounted', apply: () => {} }),
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(s: Session) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', s.user.id)
      .single()
    if (data) {
      setProfile(data)
      AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data)).catch(() => {})
    }
    setLoading(false)
  }

  useEffect(() => {
    // Restore cached profile immediately so the UI isn't blank on cold start
    AsyncStorage.getItem(PROFILE_CACHE_KEY).then(raw => {
      if (raw) {
        try { setProfile(JSON.parse(raw)) } catch {}
      }
    }).catch(() => {})

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s) loadProfile(s)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s)
      if (s) await loadProfile(s)
      else { setProfile(null); setLoading(false); AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => {}) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function refreshProfile(): Promise<void> {
    const { data: { session: s } } = await supabase.auth.getSession()
    if (s) await loadProfile(s)
  }

  async function updateProfile(
    updates: { display_name?: string; avatar_color_index?: number },
    { applyImmediately = true }: { applyImmediately?: boolean } = {}
  ): Promise<{ error: string | null; apply: () => void }> {
    if (!session) return { error: 'Not signed in.', apply: () => {} }
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', session.user.id)
    const apply = () => {
      if (!error) setProfile(prev => prev ? { ...prev, ...updates } : prev)
    }
    if (applyImmediately) apply()
    return { error: error?.message ?? null, apply }
  }

  return createElement(AuthContext.Provider, { value: { session, profile, loading, updateProfile, refreshProfile } }, children)
}

export function useAuth() {
  return useContext(AuthContext)
}
