import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    if (localDate.getHours() !== 8) continue

    const todayLocal = nowUtc.toLocaleDateString('en-CA', { timeZone: profile.timezone })
    // yesterday in local timezone
    const yesterday = new Date(new Date(todayLocal + 'T00:00:00Z').getTime() - 86400000)
      .toISOString()
      .slice(0, 10)

    const { data: chores } = await supabase
      .from('chores')
      .select('id, name')
      .eq('assigned_to', profile.id)
      .eq('due_date', yesterday)

    for (const chore of chores ?? []) {
      const { count } = await supabase
        .from('chore_completions')
        .select('*', { count: 'exact', head: true })
        .eq('chore_id', chore.id)
        .eq('for_date', yesterday)

      if ((count ?? 0) === 0) {
        messages.push({
          to: profile.push_token,
          sound: 'default',
          title: 'Overdue chore 😬',
          body: `Still waiting: ${chore.name}`,
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
