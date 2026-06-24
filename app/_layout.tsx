import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, DMSans_800ExtraBold } from '@expo-google-fonts/dm-sans'
import * as SplashScreen from 'expo-splash-screen'
import { useAuth } from '@/hooks/useAuth'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const { session, profile, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    DMSans_800ExtraBold,
  })

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync()
  }, [fontsLoaded])

  useEffect(() => {
    if (loading || !fontsLoaded) return
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
  }, [session, profile, loading, fontsLoaded])

  if (!fontsLoaded) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Slot />
    </GestureHandlerRootView>
  )
}
