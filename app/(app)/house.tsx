import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, Share, Linking, Modal, TextInput, ActivityIndicator, Image, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState, useCallback } from 'react'
import { LinearGradient } from 'expo-linear-gradient'
import * as ImagePicker from 'expo-image-picker'
import * as Updates from 'expo-updates'
import { useFocusEffect } from 'expo-router'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { Avatar } from '@/components/ui/Avatar'
import { Colors, Fonts, Shadows, AvatarGradients, Radii } from '@/constants/theme'
import { useUserAccent } from '@/context/UserAccentContext'
import { supabase } from '@/lib/supabase'


export default function HouseScreen() {
  const { accentColor } = useUserAccent()
  const { session, profile, updateProfile, refreshProfile } = useAuth()
  const { house, members, loading: houseLoading, leaveHouse, refetch: refetchHouse } = useHouse(session?.user.id)
  const [refreshing, setRefreshing] = useState(false)

  useFocusEffect(useCallback(() => { refetchHouse(); refreshProfile() }, [refetchHouse, refreshProfile]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      if (!__DEV__) {
        const update = await Updates.checkForUpdateAsync()
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync()
          await Updates.reloadAsync()
          return
        }
      }
    } catch {}
    await Promise.all([refetchHouse(), refreshProfile()])
    setRefreshing(false)
  }, [refetchHouse, refreshProfile])
  // Profile edit modal
  const [editOpen, setEditOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState(0)
  const [draftAvatarUri, setDraftAvatarUri] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isOwner = house?.created_by === session?.user.id

  function openEditProfile() {
    setDraftName(profile?.display_name ?? '')
    setDraftColor(profile?.avatar_color_index ?? 0)
    setDraftAvatarUri(null)
    setEditOpen(true)
  }

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (!result.canceled) setDraftAvatarUri(result.assets[0].uri)
  }

  async function handleSaveProfile() {
    if (!draftName.trim()) return
    setSaving(true)
    try {
      let avatar_url: string | undefined
      if (draftAvatarUri && session?.user.id) {
        const uriParts = draftAvatarUri.split('.')
        const ext = uriParts[uriParts.length - 1]?.split('?')[0] ?? 'jpg'
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
        const path = `${session.user.id}/avatar.${ext}`
        const response = await fetch(draftAvatarUri)
        const arrayBuffer = await response.arrayBuffer()
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, arrayBuffer, { contentType: mime, upsert: true })
        if (uploadError) {
          Alert.alert('Photo upload failed', uploadError.message)
          return
        }
        const { data } = supabase.storage.from('avatars').getPublicUrl(path)
        avatar_url = `${data.publicUrl}?t=${Date.now()}`
      }
      const { error } = await updateProfile(
        { display_name: draftName.trim(), avatar_color_index: draftColor, ...(avatar_url ? { avatar_url } : {}) },
        { applyImmediately: true }
      )
      if (error) { Alert.alert('Error', error); return }
      setEditOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleShareCode() {
    if (!house) return
    await Share.share({ message: `Join my house on Tidy!\n\nCode: ${house.code}\nhttps://tidy.app/join/${house.code}` })
  }

  async function handleLeave() {
    Alert.alert(
      'Leave house?',
      'Your assigned chores will become unassigned. You can rejoin with the same code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const { error } = await leaveHouse()
            if (error) Alert.alert('Error', error)
          },
        },
      ]
    )
  }

  if (houseLoading && !house) return <ActivityIndicator style={{ flex: 1 }} color={Colors.primary} />
  if (!house) return null

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>House</Text>
          <Text style={styles.headerSub}>Settings</Text>
        </View>
        <View style={styles.greeting}>
          <Text style={styles.greetSub}>Welcome back,</Text>
          <Text style={styles.greetName}>{profile?.display_name?.split(' ')[0] ?? 'there'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* House info */}
        <View style={styles.houseInfo}>
          <Text style={styles.houseName}>{house.name}</Text>
          <Text style={styles.houseSubtitle}>Your shared sanctuary</Text>
        </View>

        {/* House Code Card */}
        <View style={styles.card}>
          <Text style={styles.codeLabel}>House Code</Text>
          <View style={styles.codeRow}>
            <Text style={styles.code}>{house.code}</Text>
          </View>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShareCode} activeOpacity={0.8}>
            <Text style={styles.shareBtnText}>Share Code</Text>
          </TouchableOpacity>
        </View>

        {/* Members */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Roommates ({members.length})</Text>
          <View style={styles.card}>
            {members.map((m, idx) => {
              if (!m.profile) return null
              const isMe = m.user_id === session?.user.id
              const isMemberOwner = house.created_by === m.user_id
              const Row = isMe ? TouchableOpacity : View
              return (
                <Row
                  key={m.user_id}
                  style={[styles.memberRow, idx > 0 && styles.memberRowBorder]}
                  {...(isMe ? { onPress: openEditProfile, activeOpacity: 0.7 } : {})}
                >
                  <Avatar
                    uri={m.profile.avatar_url}
                    displayName={m.profile.display_name}
                    colorIndex={m.profile.avatar_color_index}
                    size={44}
                  />
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>
                      {isMe ? `${m.profile.display_name} (you)` : m.profile.display_name}
                    </Text>
                    <Text style={styles.memberStatus}>
                      {isMemberOwner ? 'Owner' : 'Member'}
                    </Text>
                  </View>
                  {isMemberOwner && (
                    <View style={styles.ownerBadge}>
                      <Text style={styles.ownerBadgeText}>Owner</Text>
                    </View>
                  )}
                  {isMe && (
                    <Text style={styles.editHint}>Edit →</Text>
                  )}
                </Row>
              )
            })}
            {members.length === 0 && (
              <Text style={styles.emptyMembers}>Invite your roommates to get started.</Text>
            )}
          </View>
        </View>

        {/* Notification Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.card}>
            <Text style={styles.notifHint}>Manage chore notification preferences in your device settings.</Text>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.openSettingsRow}
              onPress={() => Linking.openSettings()}
              activeOpacity={0.7}
            >
              <Text style={styles.openSettingsText}>Open notification settings →</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Leave House */}
        <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave} activeOpacity={0.7}>
          <Text style={styles.leaveBtnText}>Leave house</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit your profile</Text>

            {/* Photo */}
            <Text style={styles.modalLabel}>Profile photo</Text>
            <TouchableOpacity onPress={pickPhoto} style={styles.photoPickerRow} activeOpacity={0.7}>
              {draftAvatarUri ? (
                <Image source={{ uri: draftAvatarUri }} style={styles.photoPreview} />
              ) : profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.photoPreview} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderText}>＋</Text>
                </View>
              )}
              <Text style={styles.photoPickerLabel}>
                {draftAvatarUri ? 'Change photo' : profile?.avatar_url ? 'Change photo' : 'Add photo'}
              </Text>
            </TouchableOpacity>

            {/* Name */}
            <Text style={styles.modalLabel}>Display name</Text>
            <TextInput
              style={styles.modalInput}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Your name"
              placeholderTextColor={Colors.onSurfaceVariant}
              autoCapitalize="words"
              returnKeyType="done"
            />

            {/* Color Picker */}
            <Text style={styles.modalLabel}>Your color</Text>
            <View style={styles.colorGrid}>
              {AvatarGradients.map(([start, end], idx) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setDraftColor(idx)}
                  activeOpacity={0.8}
                  style={styles.colorSwatch}
                >
                  <LinearGradient
                    colors={[start, end]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.colorSwatchGrad, draftColor === idx && styles.colorSwatchSelected]}
                  />
                  {draftColor === idx && <Text style={styles.colorCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>

            {/* Preview */}
            <View style={styles.previewRow}>
              <LinearGradient
                colors={AvatarGradients[draftColor % AvatarGradients.length]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.previewAvatar}
              >
                <Text style={styles.previewInitial}>
                  {(draftName.trim() || 'Y')[0].toUpperCase()}
                </Text>
              </LinearGradient>
              <Text style={[styles.previewName, { color: AvatarGradients[draftColor % AvatarGradients.length][0] }]}>
                {draftName.trim() || 'Your name'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: accentColor }, (!draftName.trim() || saving) && { opacity: 0.4 }]}
              onPress={handleSaveProfile}
              disabled={!draftName.trim() || saving}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    ...Shadows.card,
  },
  headerTitle: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.primary },
  headerSub: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  greeting: { alignItems: 'flex-end' },
  greetSub: { fontSize: 11, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  greetName: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.primary },
  content: { padding: 20, gap: 24, paddingBottom: 100 },

  houseInfo: { alignItems: 'center', gap: 4 },
  houseName: { fontSize: 26, fontFamily: Fonts.bold, color: Colors.onSurface, textAlign: 'center' },
  houseSubtitle: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },

  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    ...Shadows.card,
  },

  codeLabel: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.outline, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', marginBottom: 8 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    marginBottom: 14,
  },
  code: { fontSize: 24, fontFamily: Fonts.bold, color: Colors.primary, letterSpacing: 3 },
  shareBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareBtnText: { fontSize: 14, fontFamily: Fonts.bold, color: '#fff' },


  section: { gap: 12 },
  sectionTitle: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.onSurface },

  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  memberRowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  memberStatus: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  ownerBadge: {
    backgroundColor: Colors.primaryFixed,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  ownerBadgeText: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.primary },

  editHint: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  emptyMembers: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },

  // Profile edit modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 48,
    gap: 4,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 16 },
  modalLabel: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.outline, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
  modalInput: {
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
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  colorSwatch: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  colorSwatchGrad: { width: 44, height: 44, borderRadius: 22, position: 'absolute' },
  colorSwatchSelected: { width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: Colors.onSurface },
  colorCheck: { fontSize: 18, color: '#fff', fontFamily: Fonts.bold },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, marginBottom: 4 },
  previewAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  previewInitial: { fontSize: 18, fontFamily: Fonts.bold, color: '#fff' },
  previewName: { fontSize: 18, fontFamily: Fonts.bold },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: { fontSize: 15, fontFamily: Fonts.bold, color: '#fff' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
  photoPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  photoPreview: { width: 56, height: 56, borderRadius: 28 },
  photoPlaceholder: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  photoPlaceholderText: { fontSize: 22, color: Colors.onSurfaceVariant },
  photoPickerLabel: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.primary },

  notifHint: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, paddingVertical: 4 },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 4 },
  openSettingsRow: { paddingTop: 8, alignItems: 'center' },
  openSettingsText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.primary },

  leaveBtn: { paddingVertical: 16, alignItems: 'center' },
  leaveBtnText: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.error },
})
