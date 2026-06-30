import { useState, useMemo, useCallback, useRef } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, RefreshControl, Animated } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import * as Updates from 'expo-updates'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useChores } from '@/hooks/useChores'
import { WeekStrip } from '@/components/chores/WeekStrip'
import { AvatarRow } from '@/components/chores/AvatarRow'
import { HeroCard } from '@/components/chores/HeroCard'
import { TidyLogo } from '@/components/ui/TidyLogo'
import { Colors, Fonts, Shadows, AvatarGradients } from '@/constants/theme'
import { useUserAccent } from '@/context/UserAccentContext'
import { getChoresForDay, getProgressDotColor, getMondayOfWeek } from '@/lib/chores'
import { ChoreWithCompletion } from '@/types/database'
import { useTodayPoints } from '@/hooks/useTodayPoints'
import { useStreak } from '@/hooks/useStreak'

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function HomeScreen() {
  const { accentColor } = useUserAccent()
  const { session, profile, refreshProfile } = useAuth()
  const { house, members, refetch: refetchHouse } = useHouse(session?.user.id)
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const { chores, completions, getChoresForSelectedDay, markDone, undoMarkDone, refetch } = useChores(house?.id, selectedDate)
  const [refreshing, setRefreshing] = useState(false)
  const { todayPoints } = useTodayPoints(session?.user.id)
  const { currentStreak } = useStreak(session?.user.id)

  const pillOpacity = useRef(new Animated.Value(0)).current
  const pillY = useRef(new Animated.Value(0)).current
  const [pillText, setPillText] = useState<string | null>(null)

  useFocusEffect(useCallback(() => { refetch(); refetchHouse() }, [refetch, refetchHouse]))

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
    await Promise.all([refetch(), refetchHouse(), refreshProfile()])
    setRefreshing(false)
  }, [refetch, refetchHouse, refreshProfile])

  const dotColors = useMemo(() => {
    const monday = getMondayOfWeek(selectedDate)
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setUTCDate(d.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
    const result: Record<string, 'red' | 'orange' | 'yellow' | 'green' | null> = {}
    days.forEach(day => {
      const dayChores = getChoresForDay(chores, day).filter(c => c.assigned_to !== null)
      result[day] = getProgressDotColor(dayChores, completions, day)
    })
    return result
  }, [chores, completions, selectedDate])

  const filteredChores: ChoreWithCompletion[] = getChoresForSelectedDay(selectedUserId ?? undefined)
  const incompleteChores = filteredChores.filter(c => c.completion === null)
  const heroChore = incompleteChores[0] ?? null
  const allDone = filteredChores.length > 0 && incompleteChores.length === 0

  const viewingProfile = selectedUserId
    ? members.find(m => m.user_id === selectedUserId)?.profile ?? null
    : null
  // Hero card: only show mark-done button when chore belongs to current user or is unassigned
  const heroIsActionable =
    heroChore === null ||
    heroChore.assigned_to === null ||
    heroChore.assigned_to === session?.user.id

  function getCountForMember(userId: string) {
    const mc = getChoresForSelectedDay(userId)
    return { done: mc.filter(c => c.completion !== null).length, total: mc.length }
  }

  const today = todayISO()

  function showPointPill(text: string) {
    setPillText(text)
    pillOpacity.setValue(1)
    pillY.setValue(0)
    Animated.parallel([
      Animated.timing(pillOpacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
      Animated.timing(pillY, { toValue: -60, duration: 1200, useNativeDriver: true }),
    ]).start(() => setPillText(null))
  }

  async function handleToggle(chore: ChoreWithCompletion) {
    if (!session?.user.id) return
    if (chore.completion !== null) {
      await undoMarkDone(chore.id)
    } else {
      const isOverdue = !!chore.due_date && chore.due_date < today
      showPointPill(isOverdue ? '+15' : '+10')
      await markDone(chore.id, session.user.id)
    }
  }
  const allTodayChores = getChoresForSelectedDay()
  const allDoneCount = allTodayChores.filter(c => c.completion !== null).length
  const allTotal = allTodayChores.length

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TidyLogo />
        <View style={styles.headerGreeting}>
          <Text style={styles.headerTitle}>Welcome back,</Text>
          <Text style={styles.headerName}>{profile?.display_name?.split(' ')[0] ?? 'there'}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Week Strip */}
        <View style={styles.fullBleed}>
          <WeekStrip
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            dotColors={dotColors}
          />
        </View>

        {/* Rhythm Strip */}
        {(currentStreak > 0 || todayPoints > 0) && (
          <View style={styles.rhythmStrip}>
            {currentStreak > 0 && (
              <View style={styles.rhythmChip}>
                <Text style={styles.rhythmChipText}>{currentStreak} days steady</Text>
              </View>
            )}
            {todayPoints > 0 && (
              <View style={[styles.rhythmChip, styles.rhythmChipPoints]}>
                <Text style={[styles.rhythmChipText, styles.rhythmChipTextPoints]}>+{todayPoints} today</Text>
              </View>
            )}
          </View>
        )}

        {/* Avatar Row */}
        {members.length > 0 && (
          <View style={styles.fullBleed}>
            <AvatarRow
              members={members}
              selectedUserId={selectedUserId}
              currentUserId={session?.user.id ?? ''}
              getCountForMember={getCountForMember}
              onSelect={setSelectedUserId}
            />
          </View>
        )}

        {/* Hero Card */}
        <HeroCard
          chore={heroChore}
          allDone={allDone}
          viewingProfile={viewingProfile}
          isSelf={heroIsActionable}
          onMarkDone={() => heroChore && handleToggle(heroChore)}
        />

        {/* Today's task list */}
        <Text style={styles.sectionTitle}>Today's Tasks</Text>
        {filteredChores.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {selectedUserId
                ? `${viewingProfile?.display_name?.split(' ')[0] ?? 'They'} has nothing today.`
                : 'Nothing on the list. Enjoy it while it lasts. ✦'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {filteredChores.map(chore => {
              const isDone = chore.completion !== null
              const isOverdue = !isDone && !!chore.due_date && chore.due_date < today
              const isAssignedToMe = chore.assigned_to === session?.user.id
              const colorIdx = chore.assigned_profile?.avatar_color_index ?? -1
              const barColor = colorIdx >= 0
                ? AvatarGradients[colorIdx % AvatarGradients.length][0]
                : Colors.surfaceContainerHigh
              const personLabel = chore.assigned_profile?.display_name?.split(' ')[0] ?? 'Unassigned'

              return (
                <TouchableOpacity
                  key={chore.id}
                  onPress={() => isAssignedToMe ? handleToggle(chore) : undefined}
                  activeOpacity={isAssignedToMe ? 0.7 : 1}
                  style={[styles.choreCard, isOverdue && styles.choreCardOverdue, isDone && styles.choreCardDone]}
                >
                  <View style={[styles.choreBar, { backgroundColor: barColor }]} />
                  <View style={styles.choreContent}>
                    <View style={styles.choreNameRow}>
                      <Text style={[styles.choreName, isDone && styles.choreNameDone, isOverdue && styles.choreNameOverdue]} numberOfLines={1}>
                        {chore.name}
                      </Text>
                      {isOverdue && (
                        <View style={styles.overdueBadge}>
                          <Text style={styles.overdueBadgeText}>Overdue</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.choreMeta, isOverdue && styles.choreMetaOverdue]}>{personLabel}</Text>
                    {chore.notes ? (
                      <Text style={styles.choreNotes} numberOfLines={2}>{chore.notes}</Text>
                    ) : null}
                  </View>
                  {isDone ? (
                    <View style={styles.checkCircle}>
                      <Text style={styles.checkCircleIcon}>✓</Text>
                    </View>
                  ) : isAssignedToMe ? (
                    <View style={[styles.radioOuter, isOverdue && styles.radioOuterOverdue]} />
                  ) : null}
                </TouchableOpacity>
              )
            })}
          </View>
        )}
      </ScrollView>
      {pillText && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pointPill,
            { opacity: pillOpacity, transform: [{ translateY: pillY }] },
          ]}
        >
          <Text style={styles.pointPillText}>{pillText}</Text>
        </Animated.View>
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
    paddingVertical: 15,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    ...Shadows.card,
  },
  headerGreeting: { alignItems: 'flex-end' },
  headerTitle: { fontSize: 11, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  headerName: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.primary },
  scroll: { flex: 1 },
  content: { paddingBottom: 100, gap: 16, paddingVertical: 16, paddingHorizontal: 20 },
  fullBleed: { marginHorizontal: -20 },
  sectionTitle: { fontSize: 22, fontFamily: Fonts.bold, color: Colors.onSurface },

  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 15, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, textAlign: 'center' },

  list: { gap: 10 },
  choreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
    ...Shadows.card,
  },
  choreCardOverdue: { borderColor: Colors.errorContainer },
  choreCardDone: { opacity: 0.6 },
  choreBar: { width: 4, alignSelf: 'stretch', minHeight: 60 },
  choreContent: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, gap: 3 },
  choreNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choreName: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface, flex: 1 },
  choreNameDone: { textDecorationLine: 'line-through', color: Colors.onSurfaceVariant },
  choreNameOverdue: { color: Colors.error },
  choreMeta: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  choreNotes: { fontSize: 11, fontFamily: Fonts.regular, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  choreMetaOverdue: { color: Colors.error },
  overdueBadge: { backgroundColor: Colors.errorContainer, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  overdueBadgeText: { fontSize: 9, fontFamily: Fonts.bold, color: Colors.error, textTransform: 'uppercase' },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.outlineVariant, marginRight: 16 },
  radioOuterOverdue: { borderColor: Colors.error },
  checkCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#00C853', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  checkCircleIcon: { fontSize: 15, color: '#fff', fontFamily: Fonts.bold },
  rhythmStrip: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  rhythmChip: {
    backgroundColor: Colors.surfaceContainer,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  rhythmChipPoints: {
    backgroundColor: Colors.primaryFixed,
    borderColor: Colors.primaryContainer,
  },
  rhythmChipText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
  rhythmChipTextPoints: { color: Colors.primary },
  pointPill: {
    position: 'absolute',
    bottom: 180,
    alignSelf: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  pointPillText: { fontSize: 22, fontFamily: Fonts.bold, color: '#fff' },
})
