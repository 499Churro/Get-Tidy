import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { AvatarGradients, Colors, PrimaryGradient, Radii, Shadows } from '@/constants/theme'
import { ChoreWithCompletion, Profile } from '@/types/database'

interface HeroCardProps {
  chore: ChoreWithCompletion | null
  allDone: boolean
  viewingProfile: Profile | null
  isSelf: boolean
  onMarkDone: () => void
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function HeroCard({ chore, allDone, viewingProfile, isSelf, onMarkDone }: HeroCardProps) {
  const gradColors: [string, string] = viewingProfile
    ? [...AvatarGradients[viewingProfile.avatar_color_index % AvatarGradients.length]] as [string, string]
    : [Colors.gradientStart, Colors.gradientEnd]

  const name = viewingProfile ? viewingProfile.display_name.split(' ')[0] : 'You'

  // All done or empty state
  if (allDone || !chore) {
    return (
      <View style={[styles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>
          {allDone ? 'All done for today! ✦' : `${name} has nothing today.`}
        </Text>
      </View>
    )
  }

  return (
    <LinearGradient
      colors={gradColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.decCircle} />
      <Text style={styles.eyebrow}>
        {isSelf ? 'Your chore' : `${name}'s chore`} · {chore.frequency}
      </Text>
      <Text style={styles.choreName} numberOfLines={2}>{chore.name}</Text>
      {chore.due_date && (
        <Text style={styles.dueDate}>Due {formatDate(chore.due_date)}</Text>
      )}
      {isSelf ? (
        <TouchableOpacity style={styles.ctaBtn} onPress={onMarkDone} activeOpacity={0.8}>
          <Text style={styles.ctaText}>Mark as done ✓</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.ctaBtn}>
          <Text style={styles.ctaText}>Not done yet</Text>
        </View>
      )}
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.hero,
    padding: 16,
    minHeight: 120,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    ...Shadows.card,
  },
  emptyCard: {
    backgroundColor: Colors.mutedSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decCircle: {
    position: 'absolute',
    right: -14,
    top: -14,
    width: 70,
    height: 70,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 35,
  },
  eyebrow: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 4,
  },
  choreName: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 2 },
  dueDate: { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 10 },
  ctaBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: Radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  ctaText: { fontSize: 11, color: '#fff', fontWeight: '700' },
  emptyText: { fontSize: 15, fontWeight: '700', color: Colors.textSecondary },
})
