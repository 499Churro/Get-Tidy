import { View, Text, TouchableOpacity, StyleSheet, Alert, SafeAreaView, ScrollView, Linking } from 'react-native'
import { useAuth } from '@/hooks/useAuth'
import { useHouse } from '@/hooks/useHouse'
import { MemberList } from '@/components/house/MemberList'
import { InviteSection } from '@/components/house/InviteSection'
import { Colors, Radii } from '@/constants/theme'

export default function HouseScreen() {
  const { session } = useAuth()
  const { house, members, leaveHouse } = useHouse(session?.user.id)

  async function handleLeave() {
    Alert.alert(
      'Leave house?',
      'Your assigned chores will become unassigned. You can rejoin with the same code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const { error } = await leaveHouse()
            if (error) Alert.alert('Error', error)
          },
        },
      ]
    )
  }

  if (!house) return null

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.houseName}>{house.name}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Members</Text>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>Invite your roommates to get started.</Text>
          ) : (
            <MemberList members={members} currentUserId={session?.user.id ?? ''} />
          )}
        </View>

        <View style={styles.section}>
          <InviteSection code={house.code} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Notifications</Text>
          <Text style={styles.notifHint}>
            Enable reminders to get notified when chores are due.
          </Text>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => Linking.openSettings()}
            activeOpacity={0.7}
          >
            <Text style={styles.settingsBtnText}>Open notification settings</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave} activeOpacity={0.7}>
          <Text style={styles.leaveBtnText}>Leave house</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, gap: 16, paddingBottom: 120 },
  houseName: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary, marginBottom: 4 },
  section: { backgroundColor: Colors.cardBackground, borderRadius: 16, padding: 16, gap: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.7 },
  emptyText: { fontSize: 14, color: Colors.textSecondary },
  notifHint: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  settingsBtn: { backgroundColor: Colors.mutedSurface, borderRadius: Radii.pill, paddingVertical: 10, alignItems: 'center' },
  settingsBtnText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600' },
  leaveBtn: { paddingVertical: 12, alignItems: 'center' },
  leaveBtnText: { fontSize: 15, color: Colors.overdue, fontWeight: '600' },
})
