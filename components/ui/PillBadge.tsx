import { View, Text, StyleSheet } from 'react-native'
import { Colors, Radii } from '@/constants/theme'

export function PillBadge({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.text} numberOfLines={1}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: { backgroundColor: Colors.mutedSurface, borderRadius: Radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  text: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
})
