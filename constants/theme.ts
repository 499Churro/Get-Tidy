import { LinearGradientPoint } from 'expo-linear-gradient'

export const Colors = {
  background: '#fdf9f5',
  surface: '#fdf9f5',
  surfaceContainer: '#f1ede9',
  surfaceContainerLow: '#f7f3ef',
  surfaceContainerHigh: '#ebe7e4',
  surfaceContainerLowest: '#ffffff',

  primary: '#ae2f34',
  primaryContainer: '#ff6b6b',
  primaryFixed: '#ffdad8',
  onPrimary: '#ffffff',
  onPrimaryContainer: '#6d0010',

  secondary: '#825500',
  secondaryContainer: '#fdb64b',
  onSecondaryContainer: '#704800',

  tertiary: '#006a65',
  tertiaryContainer: '#1eada5',
  onTertiary: '#ffffff',

  error: '#ba1a1a',
  errorContainer: '#ffdad6',

  onSurface: '#1c1c19',
  onSurfaceVariant: '#584140',
  outline: '#8c706f',
  outlineVariant: '#e0bfbd',

  // Legacy aliases so older screens don't break
  gradientStart: '#ae2f34',
  gradientEnd: '#fdb64b',
  textPrimary: '#1c1c19',
  textSecondary: '#584140',
  cardBackground: '#ffffff',
  mutedSurface: '#f1ede9',
  overdue: '#ba1a1a',
  complete: '#1eada5',
  orange: '#fdb64b',
  yellow: '#fdb64b',
} as const

export const PrimaryGradient = {
  colors: ['#ae2f34', '#fdb64b'] as const,
  start: { x: 0, y: 0 } as LinearGradientPoint,
  end: { x: 1, y: 1 } as LinearGradientPoint,
}

export const AvatarGradients = [
  ['#ae2f34', '#fdb64b'],
  ['#5dd9d0', '#006a65'],
  ['#b8a9e0', '#7c6abf'],
  ['#fdb64b', '#825500'],
  ['#93c5fd', '#3b82f6'],
  ['#f9a8d4', '#ec4899'],
  ['#5eead4', '#0d9488'],
  ['#bef264', '#65a30d'],
] as const

export const Radii = {
  card: 24,
  pill: 999,
  logo: 10,
  nav: 20,
  hero: 24,
  avatar: 999,
} as const

export const Fonts = {
  light: 'Quicksand_300Light',
  regular: 'Quicksand_400Regular',
  medium: 'Quicksand_500Medium',
  semibold: 'Quicksand_600SemiBold',
  bold: 'Quicksand_700Bold',
  extrabold: 'Quicksand_700Bold',
} as const

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 2,
  },
  nav: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 4,
  },
} as const
