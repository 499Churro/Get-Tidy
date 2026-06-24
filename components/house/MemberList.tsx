import { View, Text, StyleSheet } from 'react-native'
import { Avatar } from '@/components/ui/Avatar'
import { Colors } from '@/constants/theme'
import { HouseMember } from '@/types/database'

interface MemberListProps {
  members: HouseMember[]
  currentUserId: string
}

export function MemberList({ members, currentUserId }: MemberListProps) {
  return (
    <View style={styles.container}>
      {members.map(m => {
        const profile = m.profile
        if (!profile) return null
        const isMe = m.user_id === currentUserId
        return (
          <View key={m.user_id} style={styles.row}>
            <Avatar
              uri={profile.avatar_url}
              displayName={profile.display_name}
              colorIndex={profile.avatar_color_index}
              size={40}
            />
            <Text style={styles.name}>
              {isMe ? `${profile.display_name} (you)` : profile.display_name}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
})
