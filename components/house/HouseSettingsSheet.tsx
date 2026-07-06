import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Share,
  Linking,
  Modal,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native'
import { useState } from 'react'
import { LinearGradient } from 'expo-linear-gradient'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useHouseRole } from '@/hooks/useHouseRole'
import { useMomentum } from '@/context/MomentumContext'
import { Avatar } from '@/components/ui/Avatar'
import { Colors, Fonts, Shadows, AvatarGradients } from '@/constants/theme'
import { useUserAccent } from '@/context/UserAccentContext'
import { supabase } from '@/lib/supabase'
import { getRecapCopy } from '@/lib/houseMomentum'

interface HouseSettingsSheetProps {
  visible: boolean
  onClose: () => void
}

export function HouseSettingsSheet({ visible, onClose }: HouseSettingsSheetProps) {
  const { accentColor } = useUserAccent()
  const { session, profile, updateProfile } = useAuth()
  const { house, members, leaveHouse, refetch: refetchHouse } = useHouse(session?.user.id)
  const { isAdmin } = useHouseRole(members, session?.user.id)
  const { momentum, loading: momentumLoading, goal, saveGoal } = useMomentum()

  // Profile edit modal state
  const [editOpen, setEditOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState(0)
  const [draftAvatarUri, setDraftAvatarUri] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // House goal edit state
  const [goalDraft, setGoalDraft] = useState('')
  const [goalEditing, setGoalEditing] = useState(false)
  const [targetDaysDraft, setTargetDaysDraft] = useState('20')

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

  async function handleChangeMemberRole(targetUserId: string, newRole: 'admin' | 'member') {
    if (!house) return
    const { error } = await supabase.rpc('change_member_role', {
      p_house_id: house.id,
      p_target_user_id: targetUserId,
      p_new_role: newRole,
    })
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      await refetchHouse()
    }
  }

  async function handleRemoveMember(targetUserId: string) {
    if (!house) return
    Alert.alert(
      'Remove member?',
      'This will remove the member from your house. Their assigned chores will become unassigned.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('remove_member', {
              p_house_id: house.id,
              p_target_user_id: targetUserId,
            })
            if (error) {
              Alert.alert('Error', error.message)
            } else {
              await refetchHouse()
            }
          },
        },
      ]
    )
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
            if (error) Alert.alert('Cannot leave', error)
            else onClose()
          },
        },
      ]
    )
  }

  if (!house) return null

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>House Settings</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Text style={styles.closeBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
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
              <TouchableOpacity style={styles.primaryBtn} onPress={handleShareCode} activeOpacity={0.8}>
                <Text style={styles.primaryBtnText}>Share Code</Text>
              </TouchableOpacity>
            </View>

            {/* House Goal */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>House goal</Text>
              {!goal ? (
                isAdmin ? (
                  <View style={styles.card}>
                    <Text style={styles.goalEmptyTitle}>Set a house goal</Text>
                    <Text style={styles.goalEmptyBody}>
                      Add a shared reward to track your month together — like "Movie night" or "Dinner out."
                    </Text>
                    <TextInput
                      style={[styles.modalInput, { marginTop: 14 }]}
                      value={goalDraft}
                      onChangeText={setGoalDraft}
                      placeholder="e.g. Movie night"
                      placeholderTextColor={Colors.onSurfaceVariant}
                      autoCapitalize="sentences"
                      returnKeyType="done"
                      onSubmitEditing={async () => {
                        if (goalDraft.trim()) {
                          const days = Math.max(1, parseInt(targetDaysDraft) || 20)
                          const { error } = await saveGoal(goalDraft.trim(), 90, days)
                          if (error) Alert.alert('Error', error)
                          setGoalDraft('')
                          setTargetDaysDraft('20')
                        }
                      }}
                    />
                    <View style={styles.daysRow}>
                      <Text style={styles.daysLabel}>Active days target</Text>
                      <TextInput
                        style={[styles.modalInput, styles.daysInput]}
                        value={targetDaysDraft}
                        onChangeText={v => setTargetDaysDraft(v.replace(/[^0-9]/g, ''))}
                        keyboardType="number-pad"
                        maxLength={4}
                        placeholder="20"
                        placeholderTextColor={Colors.onSurfaceVariant}
                        returnKeyType="done"
                      />
                    </View>
                    <TouchableOpacity
                      style={[styles.primaryBtn, { marginTop: 12, opacity: goalDraft.trim() ? 1 : 0.4 }]}
                      disabled={!goalDraft.trim()}
                      onPress={async () => {
                        const days = Math.max(1, parseInt(targetDaysDraft) || 20)
                        const { error } = await saveGoal(goalDraft.trim(), 90, days)
                        if (error) Alert.alert('Error', error)
                        setGoalDraft('')
                        setTargetDaysDraft('20')
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.primaryBtnText}>Set goal</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.card}>
                    <Text style={styles.goalEmptyBody}>No house goal set yet. Ask an admin to add one.</Text>
                  </View>
                )
              ) : (
                <View style={styles.card}>
                  {momentum ? (
                    <>
                      <View style={styles.meterTrack}>
                        <View style={[styles.meterFill, { width: `${Math.min(100, Math.round((momentum.active_days / momentum.target_days) * 100))}%` }]} />
                      </View>
                      {isAdmin && goalEditing ? (
                        <>
                          <TextInput
                            style={[styles.modalInput, { marginTop: 4, marginBottom: 10 }]}
                            value={goalDraft}
                            onChangeText={setGoalDraft}
                            placeholder="Reward text"
                            placeholderTextColor={Colors.onSurfaceVariant}
                            autoFocus
                            returnKeyType="next"
                          />
                          <View style={styles.daysRow}>
                            <Text style={styles.daysLabel}>Active days target</Text>
                            <TextInput
                              style={[styles.modalInput, styles.daysInput]}
                              value={targetDaysDraft}
                              onChangeText={v => setTargetDaysDraft(v.replace(/[^0-9]/g, ''))}
                              keyboardType="number-pad"
                              maxLength={4}
                              placeholder="20"
                              placeholderTextColor={Colors.onSurfaceVariant}
                              returnKeyType="done"
                            />
                          </View>
                          <View style={styles.editGoalActions}>
                            <TouchableOpacity
                              style={[styles.primaryBtn, { flex: 1, opacity: goalDraft.trim() ? 1 : 0.4 }]}
                              disabled={!goalDraft.trim()}
                              onPress={async () => {
                                if (!goalDraft.trim()) return
                                const days = Math.max(1, parseInt(targetDaysDraft) || 20)
                                const { error } = await saveGoal(goalDraft.trim(), goal.target_pct, days)
                                if (error) { Alert.alert('Error', error); return }
                                setGoalEditing(false)
                                setGoalDraft('')
                              }}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.primaryBtnText}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.cancelGoalBtn}
                              onPress={() => { setGoalEditing(false); setGoalDraft('') }}
                            >
                              <Text style={styles.cancelGoalBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <TouchableOpacity
                          onPress={() => {
                            if (!isAdmin) return
                            setGoalDraft(goal.reward_text)
                            setTargetDaysDraft(goal.target_days.toString())
                            setGoalEditing(true)
                          }}
                          disabled={!isAdmin}
                          activeOpacity={isAdmin ? 0.7 : 1}
                        >
                          <Text style={styles.meterLabel}>
                            {momentum.active_days} / {momentum.target_days} days — {goal.reward_text}
                          </Text>
                          {isAdmin && <Text style={styles.editHint}>Tap to edit →</Text>}
                        </TouchableOpacity>
                      )}
                      <Text style={styles.recapCopy}>{getRecapCopy(momentum)}</Text>
                    </>
                  ) : momentumLoading ? (
                    <ActivityIndicator color={Colors.primary} />
                  ) : null}
                </View>
              )}
            </View>

            {/* Members */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Roommates ({members.length})</Text>
              <View style={styles.card}>
                {members.map((m, idx) => {
                  if (!m.profile) return null
                  const isMe = m.user_id === session?.user.id
                  const isMemberAdmin = m.role === 'admin'
                  const RowWrapper = isMe ? TouchableOpacity : View
                  return (
                    <RowWrapper
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
                          {isMemberAdmin ? 'Admin' : 'Member'}
                        </Text>
                      </View>
                      {isMe && (
                        <Text style={styles.editHint}>Edit →</Text>
                      )}
                      {!isMe && isAdmin && (
                        <TouchableOpacity
                          onPress={() =>
                            Alert.alert(
                              m.profile!.display_name,
                              'What would you like to do?',
                              [
                                {
                                  text: isMemberAdmin ? 'Make member' : 'Make admin',
                                  onPress: () => handleChangeMemberRole(m.user_id, isMemberAdmin ? 'member' : 'admin'),
                                },
                                {
                                  text: 'Remove from house',
                                  style: 'destructive',
                                  onPress: () => handleRemoveMember(m.user_id),
                                },
                                { text: 'Cancel', style: 'cancel' },
                              ]
                            )
                          }
                          activeOpacity={0.7}
                        >
                          <Text style={styles.editMemberBtn}>Edit</Text>
                        </TouchableOpacity>
                      )}
                    </RowWrapper>
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
        </View>
      </View>
    </Modal>

    {/* Edit Profile Modal — sibling of the outer sheet Modal to avoid iOS nested Modal bugs */}
    <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.profileOverlay}>
          <View style={styles.profileSheet}>
            <View style={styles.handle} />
            <Text style={styles.profileTitle}>Edit your profile</Text>

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
    </>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    paddingBottom: 48,
    ...Shadows.card,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.outlineVariant,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Colors.onSurface,
  },
  closeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeBtnText: {
    fontSize: 15,
    fontFamily: Fonts.semibold,
    color: Colors.primary,
  },

  content: { padding: 20, gap: 24, paddingBottom: 24 },

  houseInfo: { alignItems: 'center', gap: 4 },
  houseName: { fontSize: 24, fontFamily: Fonts.bold, color: Colors.onSurface, textAlign: 'center' },
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
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { fontSize: 14, fontFamily: Fonts.bold, color: '#fff' },

  section: { gap: 12 },
  sectionTitle: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.onSurface },

  goalEmptyTitle: { fontSize: 17, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 4 },
  goalEmptyBody: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, lineHeight: 18 },
  meterTrack: {
    height: 8,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 12,
  },
  meterFill: {
    height: 8,
    backgroundColor: Colors.primary,
    borderRadius: 999,
  },
  meterLabel: { fontSize: 16, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 4 },
  recapCopy: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, lineHeight: 18, marginTop: 4 },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  daysLabel: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurface },
  daysInput: { width: 72, textAlign: 'center' },
  editGoalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  cancelGoalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  cancelGoalBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },

  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  memberRowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  memberStatus: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  editHint: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  emptyMembers: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  editMemberBtn: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },

  notifHint: { fontSize: 13, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, paddingVertical: 4 },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 4 },
  openSettingsRow: { paddingTop: 8, alignItems: 'center' },
  openSettingsText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.primary },

  leaveBtn: { paddingVertical: 16, alignItems: 'center' },
  leaveBtnText: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.error },

  // Profile edit modal
  profileOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  profileSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 48,
    gap: 4,
  },
  profileTitle: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 16 },
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
})
