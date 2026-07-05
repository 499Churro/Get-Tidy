import { useMemo } from 'react'
import { HouseMember } from '@/types/database'

export function useHouseRole(
  members: HouseMember[],
  currentUserId: string | undefined
): { role: 'admin' | 'member' | null; isAdmin: boolean } {
  return useMemo(() => {
    if (!currentUserId) return { role: null, isAdmin: false }
    const me = members.find(m => m.user_id === currentUserId)
    const role = me?.role ?? null
    return { role, isAdmin: role === 'admin' }
  }, [members, currentUserId])
}
