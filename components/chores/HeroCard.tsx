import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Colors, Fonts, Radii, Shadows } from '@/constants/theme'
import { ChoreWithCompletion, Profile } from '@/types/database'
import { useUserAccent } from '@/context/UserAccentContext'

interface HeroCardProps {
  chore: ChoreWithCompletion | null
  allDone: boolean
  viewingProfile: Profile | null
  isSelf: boolean
  onMarkDone: () => void
}

function hoursUntil(dateStr: string): number | null {
  const due = new Date(dateStr + 'T23:59:00')
  const now = new Date()
  const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60)
  return Math.round(diff)
}

export function HeroCard({ chore, allDone, viewingProfile, isSelf, onMarkDone }: HeroCardProps) {
  const { accentColor } = useUserAccent()
  const emptyMessage = viewingProfile
    ? `${viewingProfile.display_name.split(' ')[0]} has nothing today.`
    : 'You have nothing today.'

  if (allDone || !chore) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>
          {allDone ? 'All done for today! ✦' : emptyMessage}
        </Text>
      </View>
    )
  }

  const assigneeName = chore.assigned_profile
    ? chore.assigned_profile.display_name.split(' ')[0]
    : 'Anyone'

  const _d = new Date()
  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`
  const isOverdue = !!chore.due_date && chore.due_date < today
  const hours = chore.due_date ? hoursUntil(chore.due_date) : null

  return (
    <View style={styles.card}>
      <View style={[styles.leftStripe, { backgroundColor: accentColor }]} />
      <View style={styles.inner}>
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <Text style={[styles.eyebrow, { color: accentColor }]}>Priority Chore</Text>
            <Text style={styles.choreName} numberOfLines={2}>{chore.name}</Text>
            <View style={styles.assigneeRow}>
              <View style={[styles.assigneeInitial, { backgroundColor: accentColor + '22' }]}>
                <Text style={[styles.assigneeInitialText, { color: accentColor }]}>{assigneeName[0]}</Text>
              </View>
              <Text style={styles.assigneeLabel}>
                {chore.assigned_to ? `Assigned to ${assigneeName}` : 'Unassigned'}
              </Text>
            </View>
          </View>
          {isSelf && (
            <TouchableOpacity style={[styles.checkBtn, { backgroundColor: accentColor + '18', borderColor: accentColor + '44' }]} onPress={onMarkDone} activeOpacity={0.7}>
              <Text style={[styles.checkIcon, { color: accentColor }]}>✓</Text>
            </TouchableOpacity>
          )}
        </View>
        {(isOverdue || hours !== null) && (
          <View style={styles.dueRow}>
            <Text style={styles.clockIcon}>⏱</Text>
            <Text style={[styles.dueText, isOverdue && styles.dueTextOverdue]}>
              {isOverdue
                ? 'Overdue'
                : hours !== null && hours <= 24
                ? `Due in ${hours}h`
                : chore.due_date ?? ''}
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    flexDirection: 'row',
    overflow: 'hidden',
    ...Shadows.card,
  },
  leftStripe: {
    width: 6,
  },
  inner: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleBlock: { flex: 1, gap: 6 },
  eyebrow: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  choreName: {
    fontSize: 20,
    fontFamily: Fonts.bold,
    color: Colors.onSurface,
  },
  assigneeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  assigneeInitial: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assigneeInitialText: { fontSize: 10, fontFamily: Fonts.bold },
  assigneeLabel: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
  checkBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIcon: { fontSize: 22, fontFamily: Fonts.bold },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clockIcon: { fontSize: 12, color: Colors.error },
  dueText: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.onSurfaceVariant },
  dueTextOverdue: { color: Colors.error },
  emptyCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radii.card,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurfaceVariant },
})
