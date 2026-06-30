import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { HouseMonthlyGoal } from '@/types/database'

function currentMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function useMonthlyGoal(houseId: string | undefined) {
  const [goal, setGoal] = useState<HouseMonthlyGoal | null>(null)

  const fetch = useCallback(async () => {
    if (!houseId) return
    const { data } = await supabase
      .from('house_monthly_goals')
      .select('*')
      .eq('house_id', houseId)
      .eq('month', currentMonthISO())
      .maybeSingle()
    setGoal(data)
  }, [houseId])

  useEffect(() => {
    fetch()
    if (!houseId) return
    const channel = supabase
      .channel(`monthly_goal:${houseId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'house_monthly_goals',
        filter: `house_id=eq.${houseId}`,
      }, fetch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetch])

  async function setGoalText(rewardText: string, targetPct = 90, targetDays = 20): Promise<{ error: string | null }> {
    if (!houseId) return { error: 'no house' }
    const { error } = await supabase
      .from('house_monthly_goals')
      .upsert({
        house_id: houseId,
        month: currentMonthISO(),
        reward_text: rewardText,
        target_pct: targetPct,
        goal_type: 'days',
        target_days: targetDays,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'house_id,month' })
    if (!error) await fetch()
    return { error: error?.message ?? null }
  }

  return { goal, setGoal: setGoalText }
}
