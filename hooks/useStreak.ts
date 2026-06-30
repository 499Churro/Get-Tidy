import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { UserStreak } from '@/types/database'

export function useStreak(userId: string | undefined) {
  const [streak, setStreak] = useState<UserStreak | null>(null)

  const fetch = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('user_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    setStreak(data)
  }, [userId])

  // useFocusEffect requires a sync callback — wrapping prevents React from treating
  // the returned Promise as a cleanup function.
  useFocusEffect(
    useCallback(() => {
      void fetch()
    }, [fetch])
  )

  return {
    currentStreak: streak?.current_streak ?? 0,
    longestStreak: streak?.longest_streak ?? 0,
  }
}
