import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Redemption } from '@/types/database'

export function useRedemptions(houseId: string | undefined, isAdmin: boolean): {
  redemptions: Redemption[]
  pendingCount: number
  loading: boolean
  refetch: () => Promise<void>
  approveRedemption: (id: string) => Promise<{ error: string | null }>
  denyRedemption: (id: string) => Promise<{ error: string | null }>
} {
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRedemptions = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)
    let query = supabase
      .from('redemptions')
      .select('*, profile:profiles!user_id(*)')
      .eq('house_id', houseId)
      .order('created_at', { ascending: false })
    if (!isAdmin) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) query = query.eq('user_id', user.id)
    } else {
      query = query.eq('status', 'pending')
    }
    const { data } = await query
    setRedemptions((data ?? []) as Redemption[])
    setLoading(false)
  }, [houseId, isAdmin])

  useEffect(() => {
    fetchRedemptions()
    if (!houseId) return
    const channel = supabase
      .channel(`redemptions:${houseId}:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redemptions', filter: `house_id=eq.${houseId}` }, fetchRedemptions)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, isAdmin, fetchRedemptions])

  async function approveRedemption(id: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.rpc('approve_redemption', { p_redemption_id: id })
    if (!error && data?.error) return { error: data.error }
    if (!error) await fetchRedemptions()
    return { error: error?.message ?? null }
  }

  async function denyRedemption(id: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.rpc('deny_redemption', { p_redemption_id: id })
    if (!error && data?.error) return { error: data.error }
    if (!error) await fetchRedemptions()
    return { error: error?.message ?? null }
  }

  const pendingCount = redemptions.filter(r => r.status === 'pending').length

  return { redemptions, pendingCount, loading, refetch: fetchRedemptions, approveRedemption, denyRedemption }
}
