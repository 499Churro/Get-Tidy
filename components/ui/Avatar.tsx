import { View, Text, Image, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { AvatarGradients } from '@/constants/theme'

interface AvatarProps {
  uri?: string | null
  displayName: string
  colorIndex: number
  size?: number
  ringColor?: string
}

export function Avatar({ uri, displayName, colorIndex, size = 38, ringColor }: AvatarProps) {
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const [gradStart, gradEnd] = AvatarGradients[colorIndex % AvatarGradients.length]

  const ringWidth = 2.5
  const outerSize = ringColor ? size + ringWidth * 2 + 2 : size

  return (
    <View
      style={{
        width: outerSize,
        height: outerSize,
        borderRadius: outerSize / 2,
        borderWidth: ringColor ? ringWidth : 0,
        borderColor: ringColor ?? 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
        }}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size }} />
        ) : (
          <LinearGradient
            colors={[gradStart, gradEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[styles.initials, { fontSize: size * 0.35 }]}>{initials}</Text>
          </LinearGradient>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  initials: { color: '#fff', fontWeight: '700' },
})
