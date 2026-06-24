import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { ChoreCard } from './ChoreCard'
import { ChoreWithCompletion } from '@/types/database'
import { Colors } from '@/constants/theme'

interface ChoreListProps {
  chores: ChoreWithCompletion[]
  currentUserId: string
  onToggle: (chore: ChoreWithCompletion) => void
  onAdd: () => void
  emptyMessage: string
}

export function ChoreList({ chores, currentUserId, onToggle, onAdd, emptyMessage }: ChoreListProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.sectionLabel}>Chores</Text>
        <TouchableOpacity onPress={onAdd} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.addBtn}>+ Add</Text>
        </TouchableOpacity>
      </View>
      {chores.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
          <TouchableOpacity onPress={onAdd} style={styles.emptyAddBtn}>
            <Text style={styles.emptyAddBtnText}>+ Add chore</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.list}>
          {chores.map(chore => (
            <ChoreCard
              key={chore.id}
              chore={chore}
              canToggle={chore.assigned_to === currentUserId}
              onToggle={() => onToggle(chore)}
            />
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textPrimary, textTransform: 'uppercase', letterSpacing: 0.7 },
  addBtn: { fontSize: 13, color: Colors.gradientStart, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: 16 },
  emptyAddBtn: { backgroundColor: Colors.mutedSurface, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  emptyAddBtnText: { fontSize: 13, color: Colors.textPrimary, fontWeight: '600' },
  list: { gap: 6 },
})
