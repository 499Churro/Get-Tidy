import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, RefreshControl, Animated, Easing } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import * as Updates from 'expo-updates'
import * as Haptics from 'expo-haptics'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { useChores } from '@/hooks/useChores'
import { WeekStrip } from '@/components/chores/WeekStrip'
import { AvatarRow } from '@/components/chores/AvatarRow'
import { HeroCard } from '@/components/chores/HeroCard'
import { TidyLogo } from '@/components/ui/TidyLogo'
import { MaterialIcons } from '@expo/vector-icons'
import { HouseSettingsSheet } from '@/components/house/HouseSettingsSheet'
import { Colors, Fonts, Shadows, AvatarGradients } from '@/constants/theme'
import { useUserAccent } from '@/context/UserAccentContext'
import { getChoresForDay, getProgressDotColor, getMondayOfWeek } from '@/lib/chores'
import { ChoreWithCompletion } from '@/types/database'
import { useStreak } from '@/hooks/useStreak'
import { useMomentum } from '@/context/MomentumContext'
import { todayLocalISO } from '@/lib/dateUtils'

const CONFETTI_COLORS = [Colors.primary, '#FFD93D', '#6BCB77', '#FF6B6B', '#C77DFF', '#4D96FF', '#FF9F1C', '#2EC4B6']
const CONFETTI_EMOJIS = ['✨', '⭐', '💫', '🎊', '🌟', '🌸', '🎉', '💛']
const CONFETTI_COUNT = 28

const ALL_DONE_MESSAGES = [
  // originals
  'All clean! ✨',
  'You crushed it 🎉',
  'House vibes: spotless 🏡',
  'Tidy mode: ON ✅',
  'The house thanks you 🌸',
  'Look at you go 🌟',
  'Adulting level: unlocked 🔓',
  'Your roommates are proud 🥹',
  'Zero chores, full vibes 🎵',
  'You did that! 💅',
  'Clean house, clear mind ✌️',
  'Streak secured 🔥',
  'Main character behavior 👑',
  'Domestic legend 🏆',
  'The cleanest one in the house 😤',
  'Mom would be proud 📞',
  'Rest mode: activated 🛋️',
  'Another one bites the dust 🫡',
  'No notes. Perfect. 🎤',
  'Chores? Never heard of her 💁',
  // new batch
  'Spotless. Iconic. You. 🫧',
  'Go touch some grass, you earned it 🌿',
  'Dirt had no chance 💀',
  'House is eating today 🍽️',
  'The mop fears you 🧹',
  'Genuinely impressive 👀',
  'Clean era has begun 🌅',
  'That was SO satisfying 😌',
  'You are the chosen one 🌈',
  'Chore boss, no notes 📋',
  'Living your best clean life 🫶',
  'The bacteria left the chat 🦠',
  'Certified clean girlie/boy 🎀',
  'Your future self thanks you 🙏',
  'Could eat off that floor probably 🍕',
  'Messy? Don\'t know her 🙅',
  'You make it look easy 😎',
  'Bestie of the house award 🥇',
  'Clean house unlocked: achievement 🎮',
  'If cleanliness is next to godliness... 😇',
  'All tasks defeated. Boss fight won. 🗡️',
  'Your aura is immaculate rn ✨',
  'Rent paid in chores 💸',
  'That\'s what I\'m talking about 🗣️',
  'You just carried the whole house 💪',
  'Legendary. No further questions. 🏛️',
  'The roommates don\'t deserve you 😭',
  'Peak domestic performance 📈',
  'POV: you just won 🎥',
  'Zero tasks remaining. Maximum chill. 😴',
  'Broom goes brrr ✅',
  'This house? Immaculate. 💎',
  'Chore-ography: flawless 🩰',
  'You ate and left no crumbs 🍽️',
  'Floor so clean you could cry 😢✨',
  'Habitually clean, chronically cute 🎀',
  'This is your villain origin story... jk 😈',
  'Clean house, chaotic mind, perfect balance 🧠',
  'Absolutely sent it 🚀',
  'That\'s the chore era we love 💖',
  'The house is literally glowing 💡',
]

type ConfettiParticle = {
  x: Animated.Value
  y: Animated.Value
  opacity: Animated.Value
  rotate: Animated.Value
  type: 'circle' | 'square' | 'emoji'
  color: string
  size: number
  emoji?: string
}

export default function HomeScreen() {
  const { accentColor } = useUserAccent()
  const { session, profile, refreshProfile } = useAuth()
  const { house, members, refetch: refetchHouse } = useHouse(session?.user.id)
  const [selectedDate, setSelectedDate] = useState(todayLocalISO())
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { chores, completions, getChoresForSelectedDay, markDone, undoMarkDone, refetch } = useChores(house?.id, selectedDate)
  const [refreshing, setRefreshing] = useState(false)
  const { currentStreak } = useStreak(session?.user.id)
  const { momentum, goal, refetch: refetchMomentum } = useMomentum()

  const progressAnim = useRef(new Animated.Value(0)).current

  // All-done toast
  const [showAllDoneToast, setShowAllDoneToast] = useState(false)
  const [allDoneMessage, setAllDoneMessage] = useState('')
  const toastOpacity = useRef(new Animated.Value(0)).current
  const toastY = useRef(new Animated.Value(30)).current
  const toastScale = useRef(new Animated.Value(0.85)).current

  // Card spring: one Animated.Value per chore id
  const cardScales = useRef<Map<string, Animated.Value>>(new Map())
  function getCardScale(id: string) {
    if (!cardScales.current.has(id)) cardScales.current.set(id, new Animated.Value(1))
    return cardScales.current.get(id)!
  }
  function springCard(id: string) {
    const s = getCardScale(id)
    s.setValue(0.93)
    Animated.spring(s, { toValue: 1, friction: 3, tension: 350, useNativeDriver: true }).start()
  }

  // Checkmark pop + wiggle: one scale + one rotate per chore id
  const checkScales = useRef<Map<string, Animated.Value>>(new Map())
  const checkRotates = useRef<Map<string, Animated.Value>>(new Map())
  function getCheckScale(id: string) {
    if (!checkScales.current.has(id)) checkScales.current.set(id, new Animated.Value(1))
    return checkScales.current.get(id)!
  }
  function getCheckRotate(id: string) {
    if (!checkRotates.current.has(id)) checkRotates.current.set(id, new Animated.Value(0))
    return checkRotates.current.get(id)!
  }
  function popCheck(id: string) {
    const s = getCheckScale(id)
    const r = getCheckRotate(id)
    s.setValue(0)
    r.setValue(0)
    Animated.parallel([
      Animated.spring(s, { toValue: 1, friction: 3, tension: 500, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(r, { toValue: -0.35, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(r, { toValue: 0, friction: 4, tension: 350, useNativeDriver: true }),
      ]),
    ]).start()
  }

  // Confetti: 12 circles + 8 squares + 8 emoji
  const confetti = useRef<ConfettiParticle[]>(
    Array.from({ length: CONFETTI_COUNT }, (_, i) => {
      if (i < 12) {
        return {
          x: new Animated.Value(0), y: new Animated.Value(0),
          opacity: new Animated.Value(0), rotate: new Animated.Value(0),
          type: 'circle' as const,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          size: 7 + (i % 4) * 3,
        }
      } else if (i < 20) {
        return {
          x: new Animated.Value(0), y: new Animated.Value(0),
          opacity: new Animated.Value(0), rotate: new Animated.Value(0),
          type: 'square' as const,
          color: CONFETTI_COLORS[(i + 2) % CONFETTI_COLORS.length],
          size: 5 + (i % 4) * 2,
        }
      } else {
        return {
          x: new Animated.Value(0), y: new Animated.Value(0),
          opacity: new Animated.Value(0), rotate: new Animated.Value(0),
          type: 'emoji' as const,
          color: 'transparent',
          size: 16 + (i % 3) * 4,
          emoji: CONFETTI_EMOJIS[(i - 20) % CONFETTI_EMOJIS.length],
        }
      }
    })
  ).current
  const [showConfetti, setShowConfetti] = useState(false)
  const prevAllMyDone = useRef(false)

  function burstConfetti() {
    setShowConfetti(true)
    confetti.forEach((p, i) => {
      const angle = (i / CONFETTI_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.7
      const dist = 100 + Math.random() * 110
      p.x.setValue(0); p.y.setValue(0); p.opacity.setValue(1); p.rotate.setValue(0)
      Animated.parallel([
        Animated.timing(p.x, { toValue: Math.cos(angle) * dist, duration: 720, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(p.y, { toValue: Math.sin(angle) * dist - 80, duration: 720, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(p.rotate, { toValue: (Math.random() - 0.5) * 14, duration: 720, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(350),
          Animated.timing(p.opacity, { toValue: 0, duration: 370, useNativeDriver: true }),
        ]),
      ]).start()
    })
    setTimeout(() => setShowConfetti(false), 850)
  }

  function showAllDoneAnimation() {
    const msg = ALL_DONE_MESSAGES[Math.floor(Math.random() * ALL_DONE_MESSAGES.length)]
    setAllDoneMessage(msg)
    setShowAllDoneToast(true)
    toastOpacity.setValue(0)
    toastY.setValue(30)
    toastScale.setValue(0.85)
    Animated.parallel([
      Animated.spring(toastY, { toValue: 0, friction: 5, tension: 380, useNativeDriver: true }),
      Animated.spring(toastScale, { toValue: 1, friction: 5, tension: 380, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      Animated.sequence([
        Animated.delay(2000),
        Animated.timing(toastOpacity, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]).start(() => setShowAllDoneToast(false))
    })
  }

  // Progress bar surge: overshoot then spring back
  useEffect(() => {
    if (!momentum || !goal) return
    const pct = Math.min(100, Math.round((momentum.active_days / momentum.target_days) * 100))
    Animated.sequence([
      Animated.timing(progressAnim, {
        toValue: Math.min(100, pct + 5),
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.spring(progressAnim, {
        toValue: pct,
        friction: 6,
        tension: 80,
        useNativeDriver: false,
      }),
    ]).start()
  }, [momentum?.active_days, momentum?.target_days, goal])

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

  // Detect when the current user finishes their last chore → confetti + toast + success haptic
  const myChores = getChoresForSelectedDay(session?.user.id ?? undefined)
  const allMyDone = myChores.length > 0 && myChores.every(c => c.completion !== null)
  useEffect(() => {
    if (allMyDone && !prevAllMyDone.current) {
      burstConfetti()
      showAllDoneAnimation()
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
    prevAllMyDone.current = allMyDone
  }, [allMyDone])

  const viewingProfile = selectedUserId
    ? members.find(m => m.user_id === selectedUserId)?.profile ?? null
    : null
  const heroIsActionable =
    heroChore === null ||
    heroChore.assigned_to === null ||
    heroChore.assigned_to === session?.user.id

  function getCountForMember(userId: string) {
    const mc = getChoresForSelectedDay(userId)
    return { done: mc.filter(c => c.completion !== null).length, total: mc.length }
  }

  const today = todayLocalISO()

  async function handleToggle(chore: ChoreWithCompletion) {
    if (!session?.user.id) return
    springCard(chore.id)
    if (chore.completion !== null) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      await undoMarkDone(chore.id)
      void refetchMomentum()
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      popCheck(chore.id)
      await markDone(chore.id, session.user.id)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TidyLogo />
        <TouchableOpacity
          onPress={() => setSettingsOpen(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="settings" size={22} color={Colors.onSurfaceVariant} />
        </TouchableOpacity>
      </View>

      {goal && momentum && (
        <View style={styles.progressCard}>
          <View style={styles.progressCardTop}>
            <Text style={styles.progressCardLabel} numberOfLines={1}>
              {goal.reward_text}
            </Text>
            <View style={styles.progressCardRight}>
              <Text style={styles.progressCardDays}>
                {momentum.active_days}/{momentum.target_days} days
              </Text>
              <View style={styles.goalIcon}>
                <Text style={styles.goalIconText}>⭐</Text>
              </View>
            </View>
          </View>
          <View style={styles.progressStrip}>
            <Animated.View style={[styles.progressFill, {
              width: progressAnim.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            }]} />
          </View>
        </View>
      )}

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
        {currentStreak > 0 && (
          <View style={styles.rhythmStrip}>
            <View style={styles.rhythmChip}>
              <Text style={styles.rhythmChipText}>{currentStreak} days steady</Text>
            </View>
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
              currentStreak={currentStreak}
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
                <Animated.View
                  key={chore.id}
                  style={{ transform: [{ scale: getCardScale(chore.id) }] }}
                >
                  <TouchableOpacity
                    onPress={() => isAssignedToMe ? handleToggle(chore) : undefined}
                    activeOpacity={isAssignedToMe ? 0.85 : 1}
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
                      <Animated.View style={[styles.checkCircle, {
                        transform: [
                          { scale: getCheckScale(chore.id) },
                          { rotate: getCheckRotate(chore.id).interpolate({ inputRange: [-1, 0, 1], outputRange: ['-60deg', '0deg', '60deg'] }) },
                        ],
                      }]}>
                        <Text style={styles.checkCircleIcon}>✓</Text>
                      </Animated.View>
                    ) : isAssignedToMe ? (
                      <View style={[styles.radioOuter, isOverdue && styles.radioOuterOverdue]} />
                    ) : null}
                  </TouchableOpacity>
                </Animated.View>
              )
            })}
          </View>
        )}
      </ScrollView>

      {/* Confetti burst: circles + squares + emoji */}
      {showConfetti && (
        <View pointerEvents="none" style={styles.confettiRoot}>
          {confetti.map((p, i) => (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                width: p.type === 'emoji' ? p.size * 1.5 : p.size,
                height: p.type === 'emoji' ? p.size * 1.5 : p.size,
                borderRadius: p.type === 'circle' ? p.size / 2 : 2,
                backgroundColor: p.type === 'emoji' ? 'transparent' : p.color,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: p.opacity,
                transform: [
                  { translateX: p.x },
                  { translateY: p.y },
                  { rotate: p.rotate.interpolate({ inputRange: [-8, 8], outputRange: ['-8rad', '8rad'] }) },
                ],
              }}
            >
              {p.type === 'emoji' && <Text style={{ fontSize: p.size }}>{p.emoji}</Text>}
            </Animated.View>
          ))}
        </View>
      )}

      {/* All-done celebration toast */}
      {showAllDoneToast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.allDoneToast,
            { opacity: toastOpacity, transform: [{ translateY: toastY }, { scale: toastScale }] },
          ]}
        >
          <Text style={styles.allDoneToastText}>{allDoneMessage}</Text>
        </Animated.View>
      )}

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
    paddingVertical: 15,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    ...Shadows.card,
  },
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
  rhythmChipText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
  progressCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 0,
  },
  progressCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressCardLabel: {
    fontSize: 13,
    fontFamily: Fonts.semibold,
    color: Colors.onSurface,
    flex: 1,
    marginRight: 8,
  },
  progressCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressCardDays: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Colors.primary,
  },
  progressStrip: {
    height: 6,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: 6,
    backgroundColor: Colors.primary,
    borderRadius: 999,
  },
  goalIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalIconText: { fontSize: 13 },
  confettiRoot: {
    position: 'absolute',
    bottom: 260,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  allDoneToast: {
    position: 'absolute',
    bottom: 140,
    alignSelf: 'center',
    backgroundColor: '#00C853',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 14,
    shadowColor: '#00C853',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  allDoneToastText: {
    fontSize: 17,
    fontFamily: Fonts.bold,
    color: '#fff',
  },
})
