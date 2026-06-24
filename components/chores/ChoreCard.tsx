import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { PrimaryGradient, Colors, Radii, Shadows } from '@/constants/theme'
import { ChoreWithCompletion } from '@/types/database'

interface ChoreCardProps {
  chore: ChoreWithCompletion
  canToggle: boolean
  onToggle: () => void
}

export function ChoreCard({ chore, canToggle, onToggle }: ChoreCardProps) {
  const isDone = chore.completion !== null
  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = !isDone && !!chore.due_date && chore.due_date < today

  return (
    <View style={[styles.card, isOverdue && styles.overdueCard, isDone && styles.doneCard]}>
      <TouchableOpacity
        onPress={canToggle ? onToggle : undefined}
        style={styles.checkbox}
        activeOpacity={canToggle ? 0.7 : 1}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {isDone ? (
          <LinearGradient {...PrimaryGradient} style={styles.checkboxFilled}>
            <Text style={styles.checkmark}>✓</Text>
          </LinearGradient>
        ) : (
          <View style={[styles.checkboxEmpty, isOverdue && styles.checkboxOverdue]} />
        )}
      </TouchableOpacity>
      <View style={styles.content}>
        <Text style={[styles.name, isDone && styles.nameDone]} numberOfLines={2}>
          {chore.name}
        </Text>
        <Text style={[styles.meta, isOverdue && styles.metaOverdue]} numberOfLines={1}>
          {chore.assigned_profile?.display_name ?? 'Unassigned'}
          {' · '}
          {chore.frequency === 'daily' ? 'Daily' : 'Weekly'}
          {isOverdue ? ' · Overdue' : ''}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardBackground,
    borderRadius: Radii.card,
    padding: 12,
    ...Shadows.card,
  },
  overdueCard: { backgroundColor: '#fff0ee', borderLeftWidth: 3, borderLeftColor: Colors.overdue },
  doneCard: { opacity: 0.55 },
  checkbox: { flexShrink: 0 },
  checkboxEmpty: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#e0d5cf' },
  checkboxOverdue: { borderColor: Colors.overdue },
  checkboxFilled: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  content: { flex: 1 },
  name: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  nameDone: { textDecorationLine: 'line-through' },
  meta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  metaOverdue: { color: Colors.overdue, fontWeight: '600' },
})
