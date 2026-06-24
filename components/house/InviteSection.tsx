import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native'
import { Colors, Radii } from '@/constants/theme'

interface InviteSectionProps {
  code: string
}

export function InviteSection({ code }: InviteSectionProps) {
  async function shareLink() {
    await Share.share({
      message: `Join my house on Tidy!\n\nCode: ${code}\nhttps://tidy.app/join/${code}`,
    })
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>House code</Text>
      <Text style={styles.code}>{code}</Text>
      <TouchableOpacity style={styles.btn} onPress={shareLink} activeOpacity={0.8}>
        <Text style={styles.btnText}>Share invite link</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  label: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.7 },
  code: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary, letterSpacing: 3 },
  btn: { backgroundColor: Colors.textPrimary, borderRadius: Radii.pill, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
