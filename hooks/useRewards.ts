import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Reward } from '@/types/database'

export function useRewards(houseId: string | undefined): {
  rewards: Reward[]
  loading: boolean
  refetch: () => Promise<void>
  addReward: (params: Omit<Reward, 'id' | 'created_at' | 'updated_at' | 'house_id' | 'created_by'>) => Promise<{ error: string | null }>
  updateReward: (id: string, updates: Partial<Pick<Reward, 'name' | 'emoji' | 'point_cost' | 'requires_approval' | 'active'>>) => Promise<{ error: string | null }>
} {
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRewards = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('rewards')
      .select('*')
      .eq('house_id', houseId)
      .eq('active', true)
      .order('created_at', { ascending: false })
    setRewards((data ?? []) as Reward[])
    setLoading(false)
  }, [houseId])

  useEffect(() => {
    fetchRewards()
    if (!houseId) return
    const channel = supabase
      .channel(`rewards:${houseId}:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rewards', filter: `house_id=eq.${houseId}` }, fetchRewards)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetchRewards])

  async function addReward(
    params: Omit<Reward, 'id' | 'created_at' | 'updated_at' | 'house_id' | 'created_by'>
  ): Promise<{ error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !houseId) return { error: 'Not authenticated' }
    const { error } = await supabase.from('rewards').insert({
      ...params,
      house_id: houseId,
      created_by: user.id,
    })
    if (!error) await fetchRewards()
    return { error: error?.message ?? null }
  }

  async function updateReward(
    id: string,
    updates: Partial<Pick<Reward, 'name' | 'emoji' | 'point_cost' | 'requires_approval' | 'active'>>
  ): Promise<{ error: string | null }> {
    const { error } = await supabase.from('rewards').update(updates).eq('id', id)
    if (!error) await fetchRewards()
    return { error: error?.message ?? null }
  }

  return { rewards, loading, refetch: fetchRewards, addReward, updateReward }
}
