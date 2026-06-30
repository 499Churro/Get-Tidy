import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isChoreActiveOnDate } from '../_shared/is-chore-active.ts'

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const nowUtc = new Date()
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, timezone, push_token')
    .not('push_token', 'is', null)

  const messages: object[] = []

  for (const profile of profiles ?? []) {
    const localDate = new Date(nowUtc.toLocaleString('en-US', { timeZone: profile.timezone }))
    const localHour = localDate.getHours()
    const localMinute = localDate.getMinutes()
    const todayLocal = nowUtc.toLocaleDateString('en-CA', { timeZone: profile.timezone })
    const localDayOfWeek = localDate.getDay()

    const { data: chores } = await supabase
      .from('chores')
      .select('id, name, frequency, due_date, days_of_week, created_at, reminder_time')
      .eq('assigned_to', profile.id)

    for (const chore of chores ?? []) {
      if (!isChoreActiveOnDate(chore, todayLocal, localDayOfWeek)) continue

      // Determine the reminder hour/minute for this chore:
      // If the chore has a custom reminder_time (HH:MM), use it.
      // Otherwise fall back to the default 8:00am.
      let targetHour = 8
      let targetMinute = 0
      if (chore.reminder_time) {
        const [h, m] = chore.reminder_time.split(':').map(Number)
        targetHour = h
        targetMinute = m
      }

      if (localHour !== targetHour || localMinute !== targetMinute) continue

      const { count } = await supabase
        .from('chore_completions')
        .select('*', { count: 'exact', head: true })
        .eq('chore_id', chore.id)
        .eq('for_date', todayLocal)

      if ((count ?? 0) === 0) {
        messages.push({
          to: profile.push_token,
          sound: 'default',
          title: 'Chore due today 🧹',
          body: `Don't forget: ${chore.name}`,
          data: { choreId: chore.id },
        })
      }
    }
  }

  if (messages.length > 0) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    })
  }

  return new Response(`sent ${messages.length}`, { status: 200 })
})
