import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, TextInput, Switch, Modal, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { MaterialIcons } from '@expo/vector-icons'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useHouseRole } from '@/hooks/useHouseRole'
import { usePointBalance } from '@/hooks/usePointBalance'
import { useRewards } from '@/hooks/useRewards'
import { useRedemptions } from '@/hooks/useRedemptions'
import { HouseSettingsSheet } from '@/components/house/HouseSettingsSheet'
import { Colors, Fonts, Shadows } from '@/constants/theme'
import { Reward } from '@/types/database'
import { supabase } from '@/lib/supabase'

export default function StoreScreen() {
  const { session } = useAuth()
  const { house, members } = useHouse(session?.user.id)
  const { isAdmin } = useHouseRole(members, session?.user.id)
  const { balance, loading: balanceLoading } = usePointBalance(house?.id)
  const { rewards, loading: rewardsLoading, addReward, updateReward } = useRewards(house?.id)
  const { redemptions, pendingCount, approveRedemption, denyRedemption } = useRedemptions(house?.id, isAdmin)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingReward, setEditingReward] = useState<Reward | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // Add/edit reward form state
  const [draftName, setDraftName] = useState('')
  const [draftEmoji, setDraftEmoji] = useState('🎁')
  const [draftCost, setDraftCost] = useState('50')
  const [draftApproval, setDraftApproval] = useState(false)
  const [saving, setSaving] = useState(false)

  function openAdd() {
    setEditingReward(null)
    setDraftName('')
    setDraftEmoji('🎁')
    setDraftCost('50')
    setDraftApproval(false)
    setAddOpen(true)
  }

  function openEdit(reward: Reward) {
    setEditingReward(reward)
    setDraftName(reward.name)
    setDraftEmoji(reward.emoji)
    setDraftCost(String(reward.point_cost))
    setDraftApproval(reward.requires_approval)
    setAddOpen(true)
  }

  async function handleSaveReward() {
    if (!draftName.trim()) return
    setSaving(true)
    try {
      const cost = Math.max(1, parseInt(draftCost) || 1)
      if (editingReward) {
        const { error } = await updateReward(editingReward.id, {
          name: draftName.trim(),
          emoji: draftEmoji,
          point_cost: cost,
          requires_approval: draftApproval,
        })
        if (error) Alert.alert('Error', error)
        else setAddOpen(false)
      } else {
        const { error } = await addReward({
          name: draftName.trim(),
          emoji: draftEmoji,
          point_cost: cost,
          requires_approval: draftApproval,
          active: true,
        })
        if (error) Alert.alert('Error', error)
        else setAddOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveReward(reward: Reward) {
    Alert.alert(
      'Remove reward?',
      'Members will no longer see this reward. Existing redemptions are unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await updateReward(reward.id, { active: false })
            if (error) Alert.alert('Error', error)
          },
        },
      ]
    )
  }

  async function handleRedeem(reward: Reward) {
    Alert.alert(
      `Redeem ${reward.emoji} ${reward.name}?`,
      `This costs ${reward.point_cost} pts. ${reward.requires_approval ? 'Requires admin approval.' : 'Instant redemption.'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Spend ${reward.point_cost} pts`,
          onPress: async () => {
            const { data, error } = await supabase.rpc('redeem_reward', { p_reward_id: reward.id })
            if (error) { Alert.alert('Error', error.message); return }
            if (data?.error === 'insufficient_points') {
              Alert.alert('Not enough points', `You need ${reward.point_cost} pts but only have ${balance}.`)
              return
            }
            if (data?.status === 'pending') {
              Alert.alert('Request sent! 🙏', 'Waiting for admin approval.')
            } else {
              Alert.alert('Redeemed! 🎉', `Enjoy: ${reward.name}`)
            }
          },
        },
      ]
    )
  }

  if (!house) return <ActivityIndicator style={{ flex: 1 }} color={Colors.primary} />

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Store</Text>
          <Text style={styles.headerSub}>{isAdmin ? 'Manage rewards' : 'Spend your points'}</Text>
        </View>
        <View style={styles.headerRight}>
          {!balanceLoading && (
            <View style={styles.balanceChip}>
              <Text style={styles.balanceText}>🪙 {balance} pts</Text>
            </View>
          )}
          <TouchableOpacity onPress={() => setSettingsOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <MaterialIcons name="settings" size={24} color={Colors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Admin: pending approvals */}
        {isAdmin && pendingCount > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending approvals ({pendingCount})</Text>
            <View style={styles.card}>
              {redemptions.filter(r => r.status === 'pending').map((r, idx) => (
                <View key={r.id} style={[styles.pendingRow, idx > 0 && styles.rowBorder]}>
                  <View style={styles.pendingInfo}>
                    <Text style={styles.pendingName}>{r.profile?.display_name ?? 'Member'}</Text>
                    <Text style={styles.pendingReward}>{r.reward_name_snapshot} · {r.point_cost_at_request} pts</Text>
                  </View>
                  <View style={styles.pendingActions}>
                    <TouchableOpacity
                      style={styles.approveBtn}
                      onPress={async () => {
                        const { error } = await approveRedemption(r.id)
                        if (error) Alert.alert('Error', error)
                      }}
                    >
                      <Text style={styles.approveBtnText}>✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.denyBtn}
                      onPress={async () => {
                        const { error } = await denyRedemption(r.id)
                        if (error) Alert.alert('Error', error)
                      }}
                    >
                      <Text style={styles.denyBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Rewards list */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Rewards</Text>
            {isAdmin && (
              <TouchableOpacity onPress={openAdd} style={styles.addBtn} activeOpacity={0.8}>
                <Text style={styles.addBtnText}>+ Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {rewardsLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : rewards.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>
                {isAdmin ? 'No rewards yet. Add one above.' : 'No rewards yet. Ask an admin to add some!'}
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              {rewards.map((reward, idx) => (
                <View key={reward.id} style={[styles.rewardRow, idx > 0 && styles.rowBorder]}>
                  <Text style={styles.rewardEmoji}>{reward.emoji}</Text>
                  <View style={styles.rewardInfo}>
                    <Text style={styles.rewardName}>{reward.name}</Text>
                    {reward.requires_approval && (
                      <Text style={styles.approvalBadge}>Needs approval</Text>
                    )}
                  </View>
                  {isAdmin ? (
                    <View style={styles.rewardAdminActions}>
                      <Text style={styles.costText}>{reward.point_cost} pts</Text>
                      <TouchableOpacity onPress={() => openEdit(reward)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="edit" size={18} color={Colors.onSurfaceVariant} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleArchiveReward(reward)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="delete-outline" size={18} color={Colors.error} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.redeemBtn, balance < reward.point_cost && styles.redeemBtnDisabled]}
                      onPress={() => handleRedeem(reward)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.redeemBtnText}>{reward.point_cost} pts</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

      </ScrollView>

      {/* Add/Edit reward sheet */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>{editingReward ? 'Edit reward' : 'Add reward'}</Text>

            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="e.g. Stay up late"
              placeholderTextColor={Colors.onSurfaceVariant}
              autoCapitalize="sentences"
            />

            <Text style={styles.inputLabel}>Emoji</Text>
            <TextInput
              style={styles.input}
              value={draftEmoji}
              onChangeText={setDraftEmoji}
              placeholder="🎁"
              maxLength={4}
            />

            <Text style={styles.inputLabel}>Point cost</Text>
            <TextInput
              style={styles.input}
              value={draftCost}
              onChangeText={v => setDraftCost(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="50"
              maxLength={5}
            />

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Requires approval</Text>
              <Switch value={draftApproval} onValueChange={setDraftApproval} />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, (!draftName.trim() || saving) && { opacity: 0.4 }]}
              onPress={handleSaveReward}
              disabled={!draftName.trim() || saving}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save reward'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAddOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <HouseSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  balanceChip: { backgroundColor: Colors.secondaryContainer, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  balanceText: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.onSecondaryContainer },

  content: { padding: 20, gap: 24, paddingBottom: 100 },

  section: { gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontFamily: Fonts.bold, color: Colors.onSurface },
  addBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
  addBtnText: { fontSize: 13, fontFamily: Fonts.bold, color: '#fff' },

  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    ...Shadows.card,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  emptyText: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, textAlign: 'center' },

  pendingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  pendingInfo: { flex: 1 },
  pendingName: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurface },
  pendingReward: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  pendingActions: { flexDirection: 'row', gap: 8 },
  approveBtn: { backgroundColor: Colors.primary, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  approveBtnText: { color: '#fff', fontFamily: Fonts.bold, fontSize: 14 },
  denyBtn: { backgroundColor: Colors.errorContainer, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  denyBtnText: { color: Colors.error, fontFamily: Fonts.bold, fontSize: 14 },

  rewardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rewardEmoji: { fontSize: 28 },
  rewardInfo: { flex: 1 },
  rewardName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  approvalBadge: { fontSize: 11, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, marginTop: 2 },
  rewardAdminActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  costText: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.primary },
  redeemBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  redeemBtnDisabled: { opacity: 0.4 },
  redeemBtnText: { fontSize: 13, fontFamily: Fonts.bold, color: '#fff' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 48, gap: 4 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface, marginBottom: 8 },
  inputLabel: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.outline, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  toggleLabel: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnText: { fontSize: 15, fontFamily: Fonts.bold, color: '#fff' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
})
