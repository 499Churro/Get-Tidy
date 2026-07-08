import { View, Text, TouchableOpacity, StyleSheet, Modal, Alert, TextInput, ActivityIndicator } from 'react-native'
import { useState, useEffect } from 'react'
import { LinearGradient } from 'expo-linear-gradient'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useHouseRole } from '@/hooks/useHouseRole'
import { Avatar } from '@/components/ui/Avatar'
import { Colors, Fonts, AvatarGradients } from '@/constants/theme'
import {
  getDeviceProfiles,
  capturePrimarySession,
  switchToProfile,
  DeviceProfile,
} from '@/lib/deviceProfiles'

interface ProfileSwitcherSheetProps {
  visible: boolean
  onClose: () => void
  onAddProfile: () => void
}

export function ProfileSwitcherSheet({ visible, onClose, onAddProfile }: ProfileSwitcherSheetProps) {
  const { session } = useAuth()
  const { house, members } = useHouse(session?.user.id)
  const { isAdmin } = useHouseRole(members, session?.user.id)

  const [profiles, setProfiles] = useState<DeviceProfile[]>([])
  const [pinTarget, setPinTarget] = useState<DeviceProfile | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    if (visible) {
      getDeviceProfiles().then(setProfiles)
    }
  }, [visible])

  function isCurrentUserManaged(): boolean {
    return session?.user.email?.endsWith('@tidy.local') ?? false
  }

  async function doSwitch(target: DeviceProfile) {
    setSwitching(true)
    if (!isCurrentUserManaged()) {
      await capturePrimarySession()
    }
    const { error } = await switchToProfile(target)
    setSwitching(false)
    if (error) {
      Alert.alert('Could not switch', error)
    } else {
      onClose()
    }
  }

  async function handleSelectProfile(target: DeviceProfile) {
    if (target.userId === session?.user.id) { onClose(); return }
    if (target.pin) {
      setPinTarget(target)
      setPinInput('')
      return
    }
    await doSwitch(target)
  }

  async function handlePinSubmit() {
    if (!pinTarget) return
    if (pinInput !== pinTarget.pin) {
      Alert.alert('Wrong PIN', 'Try again.')
      setPinInput('')
      return
    }
    const target = pinTarget
    setPinTarget(null)
    await doSwitch(target)
  }

  const currentUserId = session?.user.id

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Switch profile</Text>

            <View style={styles.profileList}>
              {profiles.map((p) => {
                const isCurrent = p.userId === currentUserId
                const grad = AvatarGradients[p.avatarColorIndex % AvatarGradients.length]
                return (
                  <TouchableOpacity
                    key={p.userId}
                    style={[styles.profileRow, isCurrent && styles.profileRowActive]}
                    onPress={() => handleSelectProfile(p)}
                    activeOpacity={0.7}
                    disabled={switching}
                  >
                    <Avatar
                      uri={p.avatarUrl}
                      displayName={p.displayName}
                      colorIndex={p.avatarColorIndex}
                      size={48}
                    />
                    <View style={styles.profileInfo}>
                      <Text style={styles.profileName}>{p.displayName}{isCurrent ? ' (you)' : ''}</Text>
                      {p.pin ? <Text style={styles.pinHint}>PIN protected</Text> : null}
                    </View>
                    {isCurrent && (
                      <LinearGradient colors={[grad[0], grad[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.checkBadge}>
                        <Text style={styles.checkMark}>✓</Text>
                      </LinearGradient>
                    )}
                  </TouchableOpacity>
                )
              })}

              {profiles.length === 0 && (
                <Text style={styles.emptyText}>No profiles set up yet.</Text>
              )}
            </View>

            {isAdmin && (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => { onClose(); onAddProfile() }}
                activeOpacity={0.8}
              >
                <Text style={styles.addBtnText}>+ Add profile</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            {switching && (
              <View style={styles.switchingOverlay}>
                <ActivityIndicator color={Colors.primary} size="large" />
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!pinTarget} transparent animationType="fade" onRequestClose={() => setPinTarget(null)}>
        <View style={styles.pinOverlay}>
          <View style={styles.pinCard}>
            <Text style={styles.pinTitle}>Enter PIN for {pinTarget?.displayName}</Text>
            <TextInput
              style={styles.pinInput}
              value={pinInput}
              onChangeText={setPinInput}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              placeholder="••••"
              placeholderTextColor={Colors.outline}
            />
            <TouchableOpacity
              style={[styles.pinSubmit, pinInput.length < 1 && { opacity: 0.4 }]}
              onPress={handlePinSubmit}
              disabled={pinInput.length < 1}
              activeOpacity={0.8}
            >
              <Text style={styles.pinSubmitText}>Unlock</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPinTarget(null)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
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
    maxHeight: '80%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginVertical: 12 },
  title: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 16 },

  profileList: { gap: 4, marginBottom: 20 },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  profileRowActive: { backgroundColor: Colors.surfaceContainerLow },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  pinHint: { fontSize: 11, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, marginTop: 2 },
  checkBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontSize: 14, fontFamily: Fonts.bold },
  emptyText: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: 16 },

  addBtn: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  addBtnText: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.primary },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },

  switchingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
  },

  pinOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  pinCard: { backgroundColor: Colors.surface, borderRadius: 24, padding: 24, width: '100%', gap: 12 },
  pinTitle: { fontSize: 17, fontFamily: Fonts.bold, color: Colors.onSurface, textAlign: 'center', marginBottom: 8 },
  pinInput: {
    fontSize: 32,
    fontFamily: Fonts.bold,
    letterSpacing: 12,
    textAlign: 'center',
    color: Colors.onSurface,
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
    paddingVertical: 12,
  },
  pinSubmit: { backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  pinSubmitText: { fontSize: 15, fontFamily: Fonts.bold, color: '#fff' },
})
