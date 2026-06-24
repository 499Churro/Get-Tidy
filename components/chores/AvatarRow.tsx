import { ScrollView, TouchableOpacity, View, Text, StyleSheet } from 'react-native'
import { Avatar } from '@/components/ui/Avatar'
import { AvatarGradients, Colors } from '@/constants/theme'
import { HouseMember } from '@/types/database'

interface CountForMember {
  done: number
  total: number
}

interface AvatarRowProps {
  members: HouseMember[]
  selectedUserId: string | null
  currentUserId: string
  getCountForMember: (userId: string) => CountForMember
  onSelect: (userId: string | null) => void
}

export function AvatarRow({ members, selectedUserId, currentUserId, getCountForMember, onSelect }: AvatarRowProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.contentContainer}>
      {members.map(member => {
        const profile = member.profile!
        const isSelected = selectedUserId === member.user_id
        const isMe = member.user_id === currentUserId
        const { done, total } = getCountForMember(member.user_id)
        const ringColor = isSelected ? AvatarGradients[profile.avatar_color_index % AvatarGradients.length][0] : undefined
        const countColor = total === 0 ? Colors.textSecondary : done === total ? Colors.complete : done === 0 ? Colors.overdue : Colors.orange

        return (
          <TouchableOpacity
            key={member.user_id}
            onPress={() => onSelect(isSelected ? null : member.user_id)}
            style={[styles.item, !isSelected && selectedUserId !== null && styles.dimmed]}
            activeOpacity={0.7}
          >
            <Avatar
              uri={profile.avatar_url}
              displayName={profile.display_name}
              colorIndex={profile.avatar_color_index}
              size={38}
              ringColor={ringColor}
            />
            <Text style={styles.name} numberOfLines={1}>
              {isMe ? 'You' : profile.display_name.split(' ')[0]}
            </Text>
            {total > 0 && (
              <Text style={[styles.count, { color: countColor }]}>
                {done}/{total}{done === total ? ' ✓' : ''}
              </Text>
            )}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  contentContainer: { flexDirection: 'row', gap: 12, paddingHorizontal: 2 },
  item: { alignItems: 'center', gap: 3, minWidth: 44 },
  dimmed: { opacity: 0.35 },
  name: { fontSize: 9, fontWeight: '600', color: Colors.textSecondary, maxWidth: 44 },
  count: { fontSize: 9, fontWeight: '700' },
})
