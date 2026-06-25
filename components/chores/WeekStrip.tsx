import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Colors, Fonts } from '@/constants/theme'
import { getMondayOfWeek } from '@/lib/chores'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const DOT_COLORS = {
  red: Colors.error,
  orange: Colors.secondaryContainer,
  yellow: Colors.secondaryContainer,
  green: Colors.tertiaryContainer,
} as const

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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {days.map((date, i) => {
        const isSelected = date === selectedDate
        const dotColor = dotColors[date]
        const dayNum = new Date(date).getUTCDate()

        return (
          <TouchableOpacity
            key={date}
            testID="week-day"
            onPress={() => onSelectDate(date)}
            style={styles.col}
            activeOpacity={0.7}
          >
            <Text style={[styles.dayLabel, isSelected && styles.dayLabelActive]}>
              {DAY_LABELS[i]}
            </Text>
            {isSelected ? (
              <View style={[styles.card, styles.cardActive]}>
                <Text style={styles.numActive}>{dayNum}</Text>
                {dotColor && (
                  <View style={styles.dotRow}>
                    <View style={[styles.dot, { backgroundColor: DOT_COLORS[dotColor] }]} />
                  </View>
                )}
              </View>
            ) : (
              <View style={[styles.card, styles.cardInactive]}>
                <Text style={styles.num}>{dayNum}</Text>
                {dotColor && (
                  <View style={styles.dotRow}>
                    <View style={[styles.dot, { backgroundColor: DOT_COLORS[dotColor] }]} />
                  </View>
                )}
              </View>
            )}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingVertical: 8, paddingHorizontal: 20 },
  col: { alignItems: 'center', gap: 4, minWidth: 48 },
  dayLabel: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Colors.onSurfaceVariant,
  },
  dayLabelActive: {
    color: Colors.onSurface,
    fontFamily: Fonts.extrabold,
  },
  card: {
    width: 48,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  cardActive: {
    backgroundColor: '#DEDAD8',
    borderWidth: 1,
    borderColor: '#C8C4C2',
  },
  cardInactive: {
    backgroundColor: Colors.surfaceContainer,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  num: {
    fontSize: 18,
    fontFamily: Fonts.semibold,
    color: Colors.onSurface,
  },
  numActive: {
    fontSize: 18,
    fontFamily: Fonts.semibold,
    color: Colors.onSurface,
  },
  dotRow: { flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 3 },
})
