import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '@/hooks/useAuth'
import { Colors } from '@/constants/theme'
import { setPendingInviteCode } from '@/lib/pendingInvite'

export default function JoinDeepLink() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const { session, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!session) {
      if (code) {
        // setPendingInviteCode is async (AsyncStorage); use inner IIFE so the
        // effect callback stays synchronous and router.replace runs after the write.
        ;(async () => {
          await setPendingInviteCode(code)
          router.replace('/(auth)/sign-in')
        })()
      } else {
        router.replace('/(auth)/sign-in')
      }
    } else {
      router.replace({ pathname: '/no-house', params: { code } })
    }
  }, [session, loading, code])

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={Colors.gradientStart} />
    </View>
  )
}
