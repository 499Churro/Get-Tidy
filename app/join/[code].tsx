import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '@/hooks/useAuth'
import { Colors } from '@/constants/theme'

export default function JoinDeepLink() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const { session, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!session) {
      router.replace('/(auth)/sign-in')
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
