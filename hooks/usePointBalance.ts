import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export function usePointBalance(houseId: string | undefined): {
  balance: number
  loading: boolean
  refetch: () => Promise<void>
} {
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchBalance = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('get_point_balance', { p_house_id: houseId })
    setBalance(data ?? 0)
    setLoading(false)
  }, [houseId])

  useEffect(() => {
    fetchBalance()
    if (!houseId) return
    const channel = supabase
      .channel(`point_ledger:${houseId}:${Date.now()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'point_ledger',
        filter: `house_id=eq.${houseId}`,
      }, fetchBalance)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetchBalance])

  return { balance, loading, refetch: fetchBalance }
}
