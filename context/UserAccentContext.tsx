import { createContext, useContext, ReactNode } from 'react'
import { AvatarGradients, PrimaryGradient } from '@/constants/theme'

interface UserAccentValue {
  accentColor: string
  accentGradient: [string, string]
}

const UserAccentContext = createContext<UserAccentValue>({
  accentColor: PrimaryGradient.colors[0],
  accentGradient: [PrimaryGradient.colors[0], PrimaryGradient.colors[1]],
})

export function UserAccentProvider({ colorIndex, children }: { colorIndex: number | null | undefined; children: ReactNode }) {
  const pair = colorIndex != null
    ? AvatarGradients[colorIndex % AvatarGradients.length]
    : PrimaryGradient.colors
  const value: UserAccentValue = {
    accentColor: pair[0],
    accentGradient: [pair[0], pair[1]],
  }
  return <UserAccentContext.Provider value={value}>{children}</UserAccentContext.Provider>
}

export function useUserAccent() {
  return useContext(UserAccentContext)
}
