import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Colors, Fonts, Radii } from '@/constants/theme'
import { useAuth } from '@/hooks/useAuth'
import { createHouse, joinHouse } from '@/lib/house'
import { supabase } from '@/lib/supabase'
import { consumePendingInviteCode } from '@/lib/pendingInvite'

export default function NoHouseScreen() {
  const { session } = useAuth()
  const { code: prefillCode } = useLocalSearchParams<{ code?: string }>()
  const router = useRouter()

  const [tab, setTab] = useState<'create' | 'join'>(prefillCode ? 'join' : 'create')
  const [houseName, setHouseName] = useState('')
  const [code, setCode] = useState(prefillCode ?? '')
  const [loading, setLoading] = useState(false)

  // On mount, check AsyncStorage for a pending invite code set before sign-in redirect.
  // Route param takes precedence; cancelled guard avoids setState after unmount.
  useEffect(() => {
    if (prefillCode) return
    let cancelled = false
    consumePendingInviteCode().then(pending => {
      if (pending && !cancelled) {
        setCode(pending)
        setTab('join')
      }
    })
    return () => { cancelled = true }
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace('/(auth)/sign-in')
  }

  async function handleCreate() {
    if (!houseName.trim()) { Alert.alert('Name required', 'Enter a name for your house.'); return }
    if (!session?.user.id) return
    setLoading(true)
    const { error } = await createHouse(session.user.id, houseName.trim())
    setLoading(false)
    if (error) {
      Alert.alert('Error', error)
      return
    }
    router.replace('/(app)')
  }

  async function handleJoin() {
    if (!code.trim()) { Alert.alert('Code required', 'Enter your house code.'); return }
    if (!session?.user.id) return
    setLoading(true)
    const { error } = await joinHouse(session.user.id, code.trim())
    setLoading(false)
    if (error) {
      Alert.alert('Error', error)
      return
    }
    router.replace('/(app)')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Top nav */}
      <View style={styles.topNav}>
        <TouchableOpacity onPress={handleSignOut} style={styles.backBtn}>
          <Text style={styles.backText}>← Sign out</Text>
        </TouchableOpacity>
      </View>

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
            <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleCreate} disabled={loading}>
              <Text style={styles.btnText}>{loading ? 'Creating…' : 'Create house'}</Text>
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
            <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleJoin} disabled={loading}>
              <Text style={styles.btnText}>{loading ? 'Joining…' : 'Join house'}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topNav: { paddingHorizontal: 16, paddingVertical: 8 },
  backBtn: { padding: 8, alignSelf: 'flex-start' },
  backText: { fontSize: 15, fontFamily: Fonts.medium, color: Colors.textSecondary },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 22, fontFamily: Fonts.extrabold, color: Colors.textPrimary, marginBottom: 36, textAlign: 'center', lineHeight: 30 },
  tabs: { flexDirection: 'row', backgroundColor: Colors.mutedSurface, borderRadius: Radii.pill, padding: 3, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: Radii.pill },
  tabActive: { backgroundColor: Colors.cardBackground },
  tabText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.textSecondary },
  tabTextActive: { color: Colors.textPrimary },
  input: { height: 50, backgroundColor: Colors.cardBackground, borderRadius: Radii.card, paddingHorizontal: 16, fontSize: 15, fontFamily: Fonts.regular, borderWidth: 1, borderColor: Colors.mutedSurface, marginBottom: 14, color: Colors.textPrimary },
  btn: { height: 50, backgroundColor: Colors.textPrimary, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 15, fontFamily: Fonts.bold },
})
