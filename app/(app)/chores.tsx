import { useRef, useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import * as Updates from 'expo-updates'
import { LinearGradient } from 'expo-linear-gradient'
import BottomSheet from '@gorhom/bottom-sheet'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useChores } from '@/hooks/useChores'
import { AddChoreSheet } from '@/components/chores/AddChoreSheet'
import { Colors, Fonts, Shadows, AvatarGradients } from '@/constants/theme'
import { useUserAccent } from '@/context/UserAccentContext'
import { Chore, Frequency } from '@/types/database'

const FREQ_LABEL: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
}

const FREQ_COLOR: Record<Frequency, string> = {
  daily: Colors.secondaryContainer,
  weekly: Colors.secondaryContainer,
  biweekly: Colors.secondaryContainer,
  monthly: Colors.secondaryContainer,
}

const FREQ_TEXT: Record<Frequency, string> = {
  daily: Colors.onSecondaryContainer,
  weekly: Colors.onSecondaryContainer,
  biweekly: Colors.onSecondaryContainer,
  monthly: Colors.onSecondaryContainer,
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function formatDays(days: number[] | null): string {
  if (!days?.length) return ''
  return days.map(d => DAY_LABELS[d]).join(' · ')
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ChoresManagerScreen() {
  const { accentGradient } = useUserAccent()
  const { session, profile } = useAuth()
  const { house, members } = useHouse(session?.user.id)
  const sheetRef = useRef<BottomSheet>(null)
  const [editingChore, setEditingChore] = useState<Chore | null>(null)

  const { chores, addChore, updateChore, deleteChore, refetch } = useChores(house?.id, todayISO())
  const [refreshing, setRefreshing] = useState(false)

  useFocusEffect(useCallback(() => { refetch() }, [refetch]))

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
    await refetch()
    setRefreshing(false)
  }, [refetch])

  function getMemberName(userId: string | null) {
    if (!userId) return 'Unassigned'
    const m = members.find(m => m.user_id === userId)
    if (!m?.profile) return 'Unknown'
    return m.profile.display_name.split(' ')[0]
  }

  function getMember(userId: string | null) {
    if (!userId) return null
    return members.find(m => m.user_id === userId) ?? null
  }

  function openAdd() {
    setEditingChore(null)
    sheetRef.current?.expand()
  }

  function openEdit(chore: Chore) {
    setEditingChore(chore)
    sheetRef.current?.expand()
  }

  function confirmDelete(chore: Chore) {
    Alert.alert(
      'Delete chore?',
      `"${chore.name}" will be removed for everyone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteChore(chore.id)
            if (error) Alert.alert('Error', error)
          },
        },
      ]
    )
  }

  // Group chores: one-time chores (have a due_date) are their own group,
  // repeating chores group by frequency (excluding those with due_date)
  type Group = { key: string; label: string; items: Chore[] }
  const oneTime = chores.filter(c => !!c.due_date)
  const repeating = chores.filter(c => !c.due_date)
  const groups: Group[] = [
    { key: 'once', label: 'One Time', items: oneTime },
    ...(['daily', 'weekly', 'biweekly', 'monthly'] as Frequency[]).map(freq => ({
      key: freq,
      label: FREQ_LABEL[freq],
      items: repeating.filter(c => c.frequency === freq),
    })),
  ].filter(g => g.items.length > 0)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Chores</Text>
          <Text style={styles.headerSub}>Manage & assign tasks</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {chores.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No chores yet</Text>
            <Text style={styles.emptySubtitle}>Tap + to create your first task.</Text>
          </View>
        ) : (
          groups.map(group => {
            const badgeBg = group.key === 'once'
              ? Colors.tertiaryContainer
              : FREQ_COLOR[group.key as Frequency] ?? Colors.surfaceContainerHigh
            const badgeFg = group.key === 'once'
              ? Colors.onTertiary
              : FREQ_TEXT[group.key as Frequency] ?? Colors.onSurfaceVariant
            return (
            <View key={group.key} style={styles.group}>
              <View style={styles.groupHeader}>
                <View style={[styles.freqBadge, { backgroundColor: badgeBg }]}>
                  <Text style={[styles.freqBadgeText, { color: badgeFg }]}>{group.label}</Text>
                </View>
                <View style={styles.groupLine} />
              </View>

              <View style={styles.groupList}>
                {group.items.map(chore => {
                  const member = getMember(chore.assigned_to)
                  const memberName = getMemberName(chore.assigned_to)

                  const stripeColorIdx = chore.assigned_profile?.avatar_color_index ?? -1
                  const stripeColor = stripeColorIdx >= 0
                    ? AvatarGradients[stripeColorIdx % AvatarGradients.length][0]
                    : Colors.surfaceContainerHigh

                  return (
                    <View
                      key={chore.id}
                      style={styles.choreCard}
                    >
                      {/* Left color strip — person's avatar color */}
                      <View style={[styles.choreStripe, { backgroundColor: stripeColor }]} />

                      <View style={styles.choreBody}>
                        <Text style={styles.choreName} numberOfLines={1}>{chore.name}</Text>
                        <Text style={[styles.assigneeName, !chore.assigned_to && styles.unassigned]}>
                          {memberName}
                        </Text>
                        {chore.due_date ? (
                          <Text style={styles.daysLabel}>{chore.due_date}</Text>
                        ) : chore.days_of_week?.length ? (
                          <Text style={styles.daysLabel}>{formatDays(chore.days_of_week)}</Text>
                        ) : null}
                        {chore.notes ? (
                          <Text style={styles.notesLabel} numberOfLines={2}>{chore.notes}</Text>
                        ) : null}
                      </View>

                      <View style={styles.choreActions}>
                        <TouchableOpacity onPress={() => openEdit(chore)} style={styles.actionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.actionBtnText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmDelete(chore)} style={[styles.actionBtn, styles.deleteBtn]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.deleteBtnText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>
            )
          })
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openAdd} activeOpacity={0.85}>
        <LinearGradient colors={accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabGradient}>
          <Text style={styles.fabIcon}>+</Text>
        </LinearGradient>
      </TouchableOpacity>

      {house && profile && (
        <AddChoreSheet
          ref={sheetRef}
          members={members}
          currentUserId={session?.user.id ?? ''}
          houseId={house.id}
          editingChore={editingChore}
          onAdd={addChore}
          onUpdate={updateChore}
          onClose={() => {
            setEditingChore(null)
            sheetRef.current?.close()
          }}
        />
      )}
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

  content: { padding: 20, paddingBottom: 120, gap: 28 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 20, fontFamily: Fonts.bold, color: Colors.onSurface },
  emptySubtitle: { fontSize: 14, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },

  group: { gap: 12 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  freqBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  freqBadgeText: { fontSize: 12, fontFamily: Fonts.bold },
  groupLine: { flex: 1, height: 1, backgroundColor: Colors.surfaceContainerHigh },

  groupList: { gap: 8 },
  choreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
    ...Shadows.card,
  },
  choreStripe: { width: 4, alignSelf: 'stretch', minHeight: 64 },
  choreBody: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, gap: 5 },
  choreName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface },
  assigneeName: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  unassigned: { color: Colors.outline, fontFamily: Fonts.medium },
  daysLabel: { fontSize: 11, fontFamily: Fonts.medium, color: Colors.outline },
  notesLabel: { fontSize: 11, fontFamily: Fonts.regular, color: Colors.onSurfaceVariant, fontStyle: 'italic' },

  choreActions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12 },
  actionBtn: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionBtnText: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
  deleteBtn: { backgroundColor: Colors.errorContainer },
  deleteBtnText: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.error },

  fab: {
    position: 'absolute',
    bottom: 84,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    ...Shadows.nav,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabIcon: { fontSize: 28, color: '#fff', lineHeight: 32 },
})
