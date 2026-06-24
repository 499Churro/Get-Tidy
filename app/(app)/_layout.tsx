import { useEffect } from 'react'
import { Tabs, useRouter } from 'expo-router'
import { Text, StyleSheet } from 'react-native'
import { Colors, Shadows, Radii } from '@/constants/theme'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'

export default function AppLayout() {
  const { session } = useAuth()
  const { house, loading: houseLoading } = useHouse(session?.user.id)
  const router = useRouter()

  useEffect(() => {
    if (houseLoading) return
    if (!house) router.replace('/no-house')
  }, [house, houseLoading])

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.gradientStart,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: styles.label,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Chores', tabBarIcon: () => <Text>🏠</Text> }} />
      <Tabs.Screen name="house" options={{ title: 'House', tabBarIcon: () => <Text>👥</Text> }} />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    borderRadius: Radii.nav,
    backgroundColor: Colors.cardBackground,
    borderTopWidth: 0,
    height: 60,
    paddingBottom: 8,
    ...Shadows.nav,
  },
  label: { fontSize: 11, fontWeight: '700' },
})
