import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useAuth } from '@/hooks/useAuth'

export default function RootLayout() {
  const { session, profile, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const inAuth = segments[0] === '(auth)'
    const inApp = segments[0] === '(app)'

    if (!session) {
      if (!inAuth) router.replace('/(auth)/sign-in')
      return
    }
    if (!profile) {
      router.replace('/(auth)/onboarding')
      return
    }
    if (!inApp) router.replace('/(app)/')
  }, [session, profile, loading])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Slot />
    </GestureHandlerRootView>
  )
}
