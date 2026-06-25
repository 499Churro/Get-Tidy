import { View, Text, StyleSheet } from 'react-native'
import { ChoreCard } from './ChoreCard'
import { ChoreWithCompletion } from '@/types/database'
import { Colors, Fonts } from '@/constants/theme'

interface ChoreListProps {
  chores: ChoreWithCompletion[]
  currentUserId: string
  onToggle: (chore: ChoreWithCompletion) => void
  onEdit: (chore: ChoreWithCompletion) => void
  onDelete: (choreId: string) => void
  onTakeOver: (choreId: string) => void
  emptyMessage: string
}

export function ChoreList({ chores, currentUserId, onToggle, onEdit, onDelete, onTakeOver, emptyMessage }: ChoreListProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Today's Tasks</Text>
      {chores.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {chores.map(chore => (
            <ChoreCard
              key={chore.id}
              chore={chore}
              currentUserId={currentUserId}
              onToggle={() => onToggle(chore)}
              onEdit={() => onEdit(chore)}
              onDelete={() => onDelete(chore.id)}
              onTakeOver={() => onTakeOver(chore.id)}
            />
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  sectionTitle: { fontSize: 22, fontFamily: Fonts.bold, color: Colors.onSurface, paddingHorizontal: 4 },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 15, fontFamily: Fonts.medium, color: Colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: 16 },
  list: { gap: 10 },
})
