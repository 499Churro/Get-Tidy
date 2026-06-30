import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isChoreActiveOnDate } from '../_shared/is-chore-active.ts'

serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Fetch all profiles that are members of any house — not filtered by push_token.
  // Streaks are a personal feature and must not depend on notification permissions.
  const { data: members } = await admin
    .from('house_members')
    .select('user_id, profiles(id, timezone)')

  // Deduplicate: a user in multiple houses should only be evaluated once
  const seen = new Set<string>()
  const profiles = (members ?? [])
    .map(m => m.profiles as { id: string; timezone: string } | null)
    .filter((p): p is { id: string; timezone: string } => p !== null && !seen.has(p.id) && seen.add(p.id) !== undefined)

  for (const profile of profiles) {
    const tz = profile.timezone ?? 'America/Los_Angeles'
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]))
    const localToday = new Date(Date.UTC(
      parseInt(partMap.year),
      parseInt(partMap.month) - 1,
      parseInt(partMap.day)
    ))
    const yesterday = new Date(localToday)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)
    const yesterdayDow = yesterday.getUTCDay()

    // Fetch chores assigned to this user active on or before yesterday.
    // Include chores archived on/after yesterday (date-aware guard in isChoreActiveOnDate handles exact boundary).
    const { data: chores } = await admin
      .from('chores')
      .select('id, due_date, frequency, days_of_week, created_at, archived_at')
      .eq('assigned_to', profile.id)
      .or(`archived_at.is.null,archived_at.gte.${yesterdayStr}`)

    const activeChores = (chores ?? []).filter(c =>
      isChoreActiveOnDate(c, yesterdayStr, yesterdayDow)
    )

    // Neutral day — no assigned active chores yesterday
    if (activeChores.length === 0) continue

    const choreIds = activeChores.map(c => c.id)
    const { count: completedCount } = await admin
      .from('chore_completions')
      .select('*', { count: 'exact', head: true })
      .in('chore_id', choreIds)
      .eq('for_date', yesterdayStr)

    const { data: streak } = await admin
      .from('user_streaks')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle()

    const current = streak ?? {
      user_id: profile.id,
      current_streak: 0,
      longest_streak: 0,
      last_active_date: null,
    }

    let newStreak: number
    let newLongest = current.longest_streak

    if ((completedCount ?? 0) === activeChores.length) {
      // All assigned chores completed yesterday
      const expectedPrev = new Date(yesterday)
      expectedPrev.setDate(expectedPrev.getDate() - 1)
      const expectedPrevStr = expectedPrev.toISOString().slice(0, 10)

      newStreak = current.last_active_date === expectedPrevStr
        ? current.current_streak + 1
        : 1

      newLongest = Math.max(newLongest, newStreak)

      await admin.from('user_streaks').upsert({
        user_id: profile.id,
        current_streak: newStreak,
        longest_streak: newLongest,
        last_active_date: yesterdayStr,
        updated_at: new Date().toISOString(),
      })
    } else {
      // Incomplete — reset streak
      await admin.from('user_streaks').upsert({
        user_id: profile.id,
        current_streak: 0,
        longest_streak: newLongest,
        last_active_date: current.last_active_date,
        updated_at: new Date().toISOString(),
      })
    }
  }

  return new Response('ok', { status: 200 })
})
