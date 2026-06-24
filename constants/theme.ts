import { LinearGradientPoint } from 'expo-linear-gradient'

export const Colors = {
  background: '#fff8f4',
  gradientStart: '#ff7c5c',
  gradientEnd: '#ffb347',
  overdue: '#ef4444',
  complete: '#22c55e',
  textPrimary: '#1a1a1a',
  textSecondary: '#92786a',
  cardBackground: '#ffffff',
  mutedSurface: '#f0ebe7',
  orange: '#fb923c',
  yellow: '#fde047',
} as const

export const PrimaryGradient = {
  colors: [Colors.gradientStart, Colors.gradientEnd] as const,
  start: { x: 0, y: 0 } as LinearGradientPoint,
  end: { x: 1, y: 1 } as LinearGradientPoint,
}

export const AvatarGradients = [
  ['#ff7c5c', '#ffb347'],
  ['#a8d8a8', '#5a9e5a'],
  ['#b8a9e0', '#7c6abf'],
  ['#fbd38d', '#e8961e'],
  ['#93c5fd', '#3b82f6'],
  ['#f9a8d4', '#ec4899'],
  ['#5eead4', '#0d9488'],
  ['#bef264', '#65a30d'],
] as const

export const Radii = {
  card: 14,
  pill: 20,
  logo: 9,
  nav: 18,
  hero: 18,
  avatar: 999,
} as const

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  nav: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
} as const
