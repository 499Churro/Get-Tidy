import { ScrollView, TouchableOpacity, View, Text, StyleSheet } from 'react-native'
import { Avatar } from '@/components/ui/Avatar'
import { AvatarGradients, Colors, Fonts } from '@/constants/theme'
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {members.map((member) => {
        const profile = member.profile!
        const isSelected = selectedUserId === member.user_id
        const isMe = member.user_id === currentUserId
        const { done, total } = getCountForMember(member.user_id)
        const dimmed = selectedUserId !== null && !isSelected
        const accentColor = AvatarGradients[profile.avatar_color_index % AvatarGradients.length][0]

        return (
          <TouchableOpacity
            key={member.user_id}
            onPress={() => onSelect(isSelected ? null : member.user_id)}
            style={[styles.item, dimmed && styles.dimmed]}
            activeOpacity={0.7}
          >
            <View style={styles.avatarWrap}>
              <Avatar
                uri={profile.avatar_url}
                displayName={profile.display_name}
                colorIndex={profile.avatar_color_index}
                size={48}
                ringColor={accentColor}
              />
              <View style={[styles.badge, { backgroundColor: accentColor }]}>
                <Text style={styles.badgeText}>{done}/{total}</Text>
              </View>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {isMe ? 'You' : profile.display_name.split(' ')[0]}
            </Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 16, paddingHorizontal: 20, paddingVertical: 4 },
  item: { alignItems: 'center', gap: 4 },
  dimmed: { opacity: 0.35 },
  avatarWrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  badgeText: { fontSize: 9, fontFamily: Fonts.bold, color: '#fff' },
  name: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.onSurfaceVariant, maxWidth: 52 },
})
