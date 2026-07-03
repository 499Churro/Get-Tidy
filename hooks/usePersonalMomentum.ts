import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { PersonalMomentum } from '@/types/database'

export function usePersonalMomentum(houseId: string | undefined, userId: string | undefined) {
  const [momentum, setMomentum] = useState<PersonalMomentum | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!houseId || !userId) { setLoading(false); return }
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }

    const { data, error } = await supabase.rpc('get_personal_momentum', {
      p_house_id: houseId,
    })
    if (!error && data) setMomentum(data as PersonalMomentum)
    setLoading(false)
  }, [houseId, userId])

  useEffect(() => {
    fetch()
    if (!houseId || !userId) return
    const channel = supabase
      .channel(`personal:${houseId}:${userId}:${Date.now()}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chore_completions',
        filter: `completed_by=eq.${userId}`,
      }, fetch)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'personal_goals',
        filter: `user_id=eq.${userId}`,
      }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, userId, fetch])

  async function savePersonalGoal(rewardText: string, targetDays: number): Promise<{ error: string | null }> {
    if (!houseId || !userId) return { error: 'Not ready' }
    const { error } = await supabase
      .from('personal_goals')
      .upsert(
        { user_id: userId, house_id: houseId, reward_text: rewardText, target_days: targetDays, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,house_id' }
      )
    if (!error) await fetch()
    return { error: error?.message ?? null }
  }

  return { momentum, loading, refetch: fetch, savePersonalGoal }
}
