import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { MaterialIcons } from '@expo/vector-icons'
import { HouseSettingsSheet } from '@/components/house/HouseSettingsSheet'
import { Colors, Fonts } from '@/constants/theme'

export default function StoreScreen() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Store</Text>
          <Text style={styles.headerSub}>Rewards coming soon</Text>
        </View>
        <TouchableOpacity
          onPress={() => setSettingsOpen(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="settings" size={24} color={Colors.onSurfaceVariant} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <Text style={styles.emptyIcon}>🏪</Text>
        <Text style={styles.emptyTitle}>Store coming soon</Text>
        <Text style={styles.emptyBody}>
          Complete chores to earn points. Spend them on rewards set by your admin.
        </Text>
      </View>

      <HouseSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: Fonts.bold,
    color: Colors.onSurface,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.onSurfaceVariant,
    marginTop: 2,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: Fonts.bold,
    color: Colors.onSurface,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
  },
})
