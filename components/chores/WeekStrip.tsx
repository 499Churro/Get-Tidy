import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Colors, PrimaryGradient, Radii } from '@/constants/theme'
import { getMondayOfWeek } from '@/lib/chores'

const DOT_COLORS = {
  red: Colors.overdue,
  orange: Colors.orange,
  yellow: Colors.yellow,
  green: Colors.complete,
} as const

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

interface WeekStripProps {
  selectedDate: string
  onSelectDate: (date: string) => void
  dotColors: Record<string, 'red' | 'orange' | 'yellow' | 'green' | null>
}

export function WeekStrip({ selectedDate, onSelectDate, dotColors }: WeekStripProps) {
  const monday = getMondayOfWeek(selectedDate)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  return (
    <View style={styles.row}>
      {days.map((date, i) => {
        const isSelected = date === selectedDate
        const dotColor = dotColors[date]
        const dayNum = new Date(date).getUTCDate()

        return (
          <TouchableOpacity
            key={date}
            testID="week-day"
            onPress={() => onSelectDate(date)}
            style={styles.dayWrapper}
            activeOpacity={0.7}
          >
            {isSelected ? (
              <LinearGradient {...PrimaryGradient} style={styles.dayCell}>
                <Text style={[styles.label, styles.labelSelected]}>{DAY_LABELS[i]}</Text>
                <Text style={[styles.num, styles.numSelected]}>{dayNum}</Text>
                {dotColor && (
                  <View style={[styles.dot, { backgroundColor: DOT_COLORS[dotColor] }]} />
                )}
              </LinearGradient>
            ) : (
              <View style={[styles.dayCell, styles.dayCellInactive]}>
                <Text style={styles.label}>{DAY_LABELS[i]}</Text>
                <Text style={styles.num}>{dayNum}</Text>
                {dotColor && (
                  <View style={[styles.dot, { backgroundColor: DOT_COLORS[dotColor] }]} />
                )}
              </View>
            )}
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  dayWrapper: { flex: 1 },
  dayCell: { borderRadius: 11, paddingVertical: 7, paddingHorizontal: 2, alignItems: 'center', gap: 2 },
  dayCellInactive: { backgroundColor: Colors.mutedSurface },
  label: { fontSize: 9, fontWeight: '600', color: Colors.textSecondary },
  labelSelected: { color: 'rgba(255,255,255,0.85)' },
  num: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  numSelected: { color: '#fff' },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 2 },
})
