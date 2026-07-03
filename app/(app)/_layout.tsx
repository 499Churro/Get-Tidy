import { Tabs } from 'expo-router'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { MomentumProvider } from '@/context/MomentumContext'

type BottomTabBarProps = React.ComponentProps<typeof Tabs>['tabBar'] extends ((props: infer P) => unknown) | undefined ? P : never
import { Colors, Fonts, Shadows } from '@/constants/theme'

type IconName = React.ComponentProps<typeof MaterialIcons>['name']

const TAB_CONFIG: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  chores: { label: 'Chores', icon: 'checklist' },
  house: { label: 'House', icon: 'people' },
}

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index
        const config = TAB_CONFIG[route.name] ?? { label: route.name, icon: 'circle' as IconName }

        return (
          <TouchableOpacity
            key={route.key}
            onPress={() => navigation.navigate(route.name)}
            activeOpacity={0.7}
            style={[styles.tabBtn, focused && styles.tabBtnActive]}
          >
            <MaterialIcons
              name={config.icon}
              size={22}
              color={focused ? Colors.onSecondaryContainer : Colors.onSurfaceVariant}
            />
            <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>
              {config.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export default function AppLayout() {
  return (
    <MomentumProvider>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="chores" />
        <Tabs.Screen name="house" />
      </Tabs>
    </MomentumProvider>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    ...Shadows.nav,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 999,
    gap: 2,
  },
  tabBtnActive: {
    backgroundColor: Colors.secondaryContainer,
    paddingVertical: 8,
  },
  tabLabel: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.onSurfaceVariant },
  tabLabelActive: { color: Colors.onSecondaryContainer },
})
