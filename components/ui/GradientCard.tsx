import { LinearGradient } from 'expo-linear-gradient'
import { Radii, Shadows } from '@/constants/theme'
import { ViewStyle } from 'react-native'

interface GradientCardProps {
  colors: readonly [string, string] | [string, string]
  children: React.ReactNode
  style?: ViewStyle
}

export function GradientCard({ colors, children, style }: GradientCardProps) {
  return (
    <LinearGradient
      colors={colors as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius: Radii.hero, padding: 16, overflow: 'hidden', ...Shadows.card }, style]}
    >
      {children}
    </LinearGradient>
  )
}
