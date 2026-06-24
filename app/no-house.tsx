import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, SafeAreaView } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Colors, Radii } from '@/constants/theme'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'

export default function NoHouseScreen() {
  const { session } = useAuth()
  const { createHouse, joinHouse } = useHouse(session?.user.id)
  const { code: prefillCode } = useLocalSearchParams<{ code?: string }>()

  const [tab, setTab] = useState<'create' | 'join'>(prefillCode ? 'join' : 'create')
  const [houseName, setHouseName] = useState('')
  const [code, setCode] = useState(prefillCode ?? '')
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!houseName.trim()) { Alert.alert('Name required', 'Enter a name for your house.'); return }
    setLoading(true)
    const { error } = await createHouse(houseName.trim())
    setLoading(false)
    if (error) Alert.alert('Error', error)
  }

  async function handleJoin() {
    if (!code.trim()) { Alert.alert('Code required', 'Enter your house code.'); return }
    setLoading(true)
    const { error } = await joinHouse(code.trim())
    setLoading(false)
    if (error) Alert.alert('Error', error)
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Create or join a house{'\n'}to get started.</Text>

        <View style={styles.tabs}>
          {(['create', 'join'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'create' ? 'Create house' : 'Join house'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'create' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="House name (e.g. Apt 4B)"
              value={houseName}
              onChangeText={setHouseName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            <TouchableOpacity style={styles.btn} onPress={handleCreate} disabled={loading}>
              <Text style={styles.btnText}>{loading ? 'Creating...' : 'Create house'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="House code (e.g. TIDY-4B2K)"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleJoin}
            />
            <TouchableOpacity style={styles.btn} onPress={handleJoin} disabled={loading}>
              <Text style={styles.btnText}>{loading ? 'Joining...' : 'Join house'}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary, marginBottom: 36, textAlign: 'center', lineHeight: 30 },
  tabs: { flexDirection: 'row', backgroundColor: Colors.mutedSurface, borderRadius: Radii.pill, padding: 3, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: Radii.pill },
  tabActive: { backgroundColor: Colors.cardBackground },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.textPrimary },
  input: { height: 50, backgroundColor: Colors.cardBackground, borderRadius: Radii.card, paddingHorizontal: 16, fontSize: 15, borderWidth: 1, borderColor: Colors.mutedSurface, marginBottom: 14 },
  btn: { height: 50, backgroundColor: Colors.textPrimary, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
