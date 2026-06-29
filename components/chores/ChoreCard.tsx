import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { Colors, Fonts, Radii, Shadows } from '@/constants/theme'
import { ChoreWithCompletion } from '@/types/database'

interface ChoreCardProps {
  chore: ChoreWithCompletion
  currentUserId: string
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onTakeOver: () => void
}

function localDateISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ChoreCard({ chore, currentUserId, onToggle, onEdit, onDelete, onTakeOver }: ChoreCardProps) {
  const isDone = chore.completion !== null
  const today = localDateISO()
  const isOverdue = !isDone && !!chore.due_date && chore.due_date < today
  const isUnassigned = !chore.assigned_to
  const isAssignedToMe = chore.assigned_to === currentUserId
  const isAssignedToOther = !!chore.assigned_to && !isAssignedToMe

  const barColor = isDone
    ? Colors.tertiaryContainer
    : isOverdue
    ? Colors.error
    : Colors.secondaryContainer

  const personLabel = chore.assigned_profile?.display_name?.split(' ')[0] ?? 'Unassigned'

  function showMenu() {
    const options: Parameters<typeof Alert.alert>[2] = []
    if (isAssignedToOther && !isDone) {
      options.push({ text: 'Take over', onPress: onTakeOver })
    }
    if (!isDone && isUnassigned) {
      options.push({ text: 'Assign to me', onPress: onTakeOver })
    }
    options.push({ text: 'Edit', onPress: onEdit })
    options.push({ text: 'Delete', style: 'destructive', onPress: () => {
      Alert.alert('Delete chore?', `"${chore.name}" will be removed for everyone.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ])
    }})
    options.push({ text: 'Cancel', style: 'cancel' })
    Alert.alert(chore.name, undefined, options)
  }

  return (
    <View style={[styles.card, isOverdue && styles.overdueCard, isDone && styles.doneCard]}>
      <View style={[styles.leftBar, { backgroundColor: barColor }]} />
      <View style={styles.content}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, isDone && styles.nameDone, isOverdue && styles.nameOverdue]} numberOfLines={1}>
            {chore.name}
          </Text>
          {isOverdue && (
            <View style={styles.overdueBadge}>
              <Text style={styles.overdueBadgeText}>Overdue</Text>
            </View>
          )}
        </View>
        <Text style={[styles.meta, isOverdue && styles.metaOverdue]} numberOfLines={1}>
          {personLabel}
        </Text>
      </View>

      <View style={styles.actions}>
        {isDone ? (
          <View style={styles.checkCircle}>
            <Text style={styles.checkCircleIcon}>✓</Text>
          </View>
        ) : isUnassigned ? (
          <TouchableOpacity style={styles.claimBtn} onPress={onTakeOver} activeOpacity={0.8}>
            <Text style={styles.claimBtnText}>Claim</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.radioBtn}
            onPress={isAssignedToMe ? onToggle : undefined}
            activeOpacity={isAssignedToMe ? 0.7 : 1}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={[styles.radioOuter, isOverdue && styles.radioOuterOverdue]} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={showMenu} style={styles.menuBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.menuIcon}>•••</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
    ...Shadows.card,
  },
  overdueCard: { borderColor: Colors.errorContainer },
  doneCard: { opacity: 0.6 },
  leftBar: { width: 4, alignSelf: 'stretch', minHeight: 60 },
  content: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.onSurface, flex: 1 },
  nameDone: { textDecorationLine: 'line-through', color: Colors.onSurfaceVariant },
  nameOverdue: { color: Colors.error },
  meta: { fontSize: 12, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant },
  metaOverdue: { color: Colors.error },
  overdueBadge: {
    backgroundColor: Colors.errorContainer,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  overdueBadgeText: { fontSize: 9, fontFamily: Fonts.bold, color: Colors.error, textTransform: 'uppercase' },
  actions: { flexDirection: 'row', alignItems: 'center', paddingRight: 12, gap: 8 },
  radioBtn: { padding: 4 },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
  },
  radioOuterOverdue: { borderColor: Colors.error },
  checkCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.tertiaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleIcon: { fontSize: 15, color: Colors.onTertiary, fontFamily: Fonts.bold },
  claimBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  claimBtnText: { fontSize: 12, fontFamily: Fonts.bold, color: '#fff' },
  menuBtn: { paddingLeft: 4 },
  menuIcon: { fontSize: 11, color: Colors.onSurfaceVariant, letterSpacing: 1, fontFamily: Fonts.bold },
})
