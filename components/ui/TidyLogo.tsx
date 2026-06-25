import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Radii, Fonts, PrimaryGradient, Colors } from '@/constants/theme'

export function TidyLogo() {
  return (
    <View style={styles.row}>
      <LinearGradient {...PrimaryGradient} style={styles.box}>
        <Text style={styles.star}>✦</Text>
      </LinearGradient>
      <Text style={styles.wordmark}>Tidy</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  box: { width: 32, height: 32, borderRadius: Radii.logo, alignItems: 'center', justifyContent: 'center' },
  star: { fontSize: 16, color: '#fff' },
  wordmark: { fontSize: 22, fontFamily: Fonts.bold, letterSpacing: 0.5, color: Colors.primary },
})
