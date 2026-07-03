import { createContext, useContext, ReactNode, createElement, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useHouseMomentum } from '@/hooks/useHouseMomentum'
import { useMonthlyGoal } from '@/hooks/useMonthlyGoal'
import { HouseMomentum, HouseMonthlyGoal } from '@/types/database'

interface MomentumState {
  momentum: HouseMomentum | null
  goal: HouseMonthlyGoal | null
  loading: boolean
  refetch: () => Promise<void>
  saveGoal: (rewardText: string, targetPct?: number, targetDays?: number) => Promise<{ error: string | null }>
}

const MomentumContext = createContext<MomentumState>({
  momentum: null,
  goal: null,
  loading: true,
  refetch: async () => {},
  saveGoal: async () => ({ error: 'MomentumProvider not mounted' }),
})

export function MomentumProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [houseId, setHouseId] = useState<string | undefined>()

  useEffect(() => {
    if (!session?.user.id) return
    supabase
      .from('house_members')
      .select('house_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setHouseId(data.house_id) })
  }, [session?.user.id])

  const { momentum, loading, refetch } = useHouseMomentum(houseId)
  const { goal, setGoal: saveGoal } = useMonthlyGoal(houseId)

  return createElement(MomentumContext.Provider, { value: { momentum, goal, loading, refetch, saveGoal } }, children)
}

export function useMomentum() {
  return useContext(MomentumContext)
}
