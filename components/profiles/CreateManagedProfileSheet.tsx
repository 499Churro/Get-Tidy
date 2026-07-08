import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Alert, Switch, ActivityIndicator, ScrollView } from 'react-native'
import { useState } from 'react'
import { LinearGradient } from 'expo-linear-gradient'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { Colors, Fonts, AvatarGradients } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import {
  addDeviceProfile,
  capturePrimarySession,
  generateManagedPassword,
} from '@/lib/deviceProfiles'

interface CreateManagedProfileSheetProps {
  visible: boolean
  onClose: () => void
  onCreated: () => void
}

export function CreateManagedProfileSheet({ visible, onClose, onCreated }: CreateManagedProfileSheetProps) {
  const { session } = useAuth()
  const { house } = useHouse(session?.user.id)

  const [name, setName] = useState('')
  const [colorIndex, setColorIndex] = useState(0)
  const [pinEnabled, setPinEnabled] = useState(false)
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setName('')
    setColorIndex(0)
    setPinEnabled(false)
    setPin('')
  }

  async function handleCreate() {
    if (!name.trim() || !house || !session) return
    if (pinEnabled && pin.length < 4) {
      Alert.alert('PIN too short', 'PIN must be 4 digits.')
      return
    }

    setSaving(true)
    try {
      await capturePrimarySession()

      const password = generateManagedPassword()

      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) { Alert.alert('Error', 'Not signed in'); setSaving(false); return }

      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/create-managed-profile`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string),
          },
          body: JSON.stringify({
            name: name.trim(),
            avatarColorIndex: colorIndex,
            houseId: house.id,
            password,
          }),
        }
      )
      const result = await response.json()
      if (!response.ok || result.error) {
        Alert.alert('Error', result.error ?? 'Failed to create profile')
        setSaving(false)
        return
      }

      await addDeviceProfile({
        userId: result.userId,
        email: result.email,
        password,
        displayName: name.trim(),
        avatarColorIndex: colorIndex,
        avatarUrl: null,
        pin: pinEnabled && pin ? pin : null,
        isManaged: true,
        houseId: house.id,
      })

      reset()
      onCreated()
      onClose()
    } catch (e) {
      Alert.alert('Error', String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Add profile</Text>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Mom, Jake, Lily..."
              placeholderTextColor={Colors.onSurfaceVariant}
              autoCapitalize="words"
              autoFocus
            />

            <Text style={styles.label}>Color</Text>
            <View style={styles.colorGrid}>
              {AvatarGradients.map((grad, idx) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setColorIndex(idx)}
                  style={styles.colorSwatch}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[grad[0], grad[1]]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.colorSwatchGrad, colorIndex === idx && styles.colorSwatchSelected]}
                  />
                  {colorIndex === idx && <Text style={styles.colorCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>PIN protection</Text>
                <Text style={styles.toggleHint}>Prevent others from switching to this profile</Text>
              </View>
              <Switch value={pinEnabled} onValueChange={setPinEnabled} />
            </View>

            {pinEnabled && (
              <>
                <Text style={styles.label}>PIN (4 digits)</Text>
                <TextInput
                  style={styles.input}
                  value={pin}
                  onChangeText={v => setPin(v.replace(/[^0-9]/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  secureTextEntry
                  placeholder="••••"
                  placeholderTextColor={Colors.outline}
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.createBtn, (!name.trim() || saving) && { opacity: 0.4 }]}
              onPress={handleCreate}
              disabled={!name.trim() || saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.createBtnText}>Create profile</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '88%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginVertical: 12 },
  title: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 16 },

  label: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.outline, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: Fonts.semibold,
    color: Colors.onSurface,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },

  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4, marginBottom: 8 },
  colorSwatch: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  colorSwatchGrad: { width: 44, height: 44, borderRadius: 22, position: 'absolute' },
  colorSwatchSelected: { width: 48, height: 48, borderRadius: 24 },
  colorCheck: { fontSize: 18, color: '#fff', fontFamily: Fonts.bold },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  toggleLabel: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  toggleHint: { fontSize: 12, fontFamily: Fonts.regular, color: Colors.onSurfaceVariant, marginTop: 2 },

  createBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  createBtnText: { fontSize: 15, fontFamily: Fonts.bold, color: '#fff' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
})
