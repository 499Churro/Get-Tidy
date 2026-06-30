import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { HouseMomentum } from '@/types/database'

function currentMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function useHouseMomentum(houseId: string | undefined) {
  const [momentum, setMomentum] = useState<HouseMomentum | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }

    const res = await supabase.functions.invoke('get-house-momentum', {
      body: { house_id: houseId, month: currentMonthISO() },
    })
    if (!res.error && res.data) setMomentum(res.data as HouseMomentum)
    setLoading(false)
  }, [houseId])

  useEffect(() => {
    fetch()
    if (!houseId) return
    const channel = supabase
      .channel(`momentum:${houseId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chore_completions',
      }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetch])

  return { momentum, loading, refetch: fetch }
}
