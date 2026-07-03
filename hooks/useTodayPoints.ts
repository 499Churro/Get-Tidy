import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useTodayPoints(userId: string | undefined) {
  const [todayPoints, setTodayPoints] = useState(0)

  const fetch = useCallback(async () => {
    if (!userId) { setTodayPoints(0); return }
    const { data } = await supabase
      .from('score_ledger')
      .select('points')
      .eq('user_id', userId)
      .eq('for_date', todayISO())
    const sum = (data ?? []).reduce((acc, row) => acc + row.points, 0)
    setTodayPoints(Math.max(0, sum))
  }, [userId])

  useEffect(() => {
    fetch()
    if (!userId) return
    const channel = supabase
      .channel(`score_ledger:${userId}:${Date.now()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'score_ledger',
        filter: `user_id=eq.${userId}`,
      }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, fetch])

  return { todayPoints }
}
