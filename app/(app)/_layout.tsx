import { Tabs } from 'expo-router'
import { Text, StyleSheet } from 'react-native'
import { Colors, Shadows, Radii } from '@/constants/theme'

export default function AppLayout() {
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
