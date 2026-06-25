import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import {
  useFonts,
  Quicksand_300Light,
  Quicksand_400Regular,
  Quicksand_500Medium,
  Quicksand_600SemiBold,
  Quicksand_700Bold,
} from '@expo-google-fonts/quicksand'
import * as SplashScreen from 'expo-splash-screen'
import { useAuth, AuthProvider } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { UserAccentProvider } from '@/context/UserAccentContext'

SplashScreen.preventAutoHideAsync()

function RootLayoutInner({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { session, profile, loading: authLoading } = useAuth()
  const { house, loading: houseLoading } = useHouse(session?.user.id)
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (authLoading || houseLoading || !fontsLoaded) return

    if (!session) {
      router.replace('/(auth)/sign-in')
      return
    }
    if (!profile) {
      router.replace('/(auth)/onboarding')
      return
    }
    if (!house) {
      router.replace('/no-house')
      return
    }
    if (segments[0] !== '(app)') {
      router.replace('/(app)')
    }
  }, [session, profile, house, authLoading, houseLoading, fontsLoaded])

  return (
    <UserAccentProvider colorIndex={profile?.avatar_color_index}>
      <Slot />
    </UserAccentProvider>
  )
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Quicksand_300Light,
    Quicksand_400Regular,
    Quicksand_500Medium,
    Quicksand_600SemiBold,
    Quicksand_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootLayoutInner fontsLoaded={fontsLoaded} />
      </AuthProvider>
    </GestureHandlerRootView>
  )
}
