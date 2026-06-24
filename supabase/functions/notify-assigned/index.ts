import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const payload = await req.json()
    const record = payload.record
    if (!record?.assigned_to) return new Response('no assignee', { status: 200 })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token, display_name')
      .eq('id', record.assigned_to)
      .single()

    if (!profile?.push_token) return new Response('no push token', { status: 200 })

    const message = {
      to: profile.push_token,
      sound: 'default',
      title: 'New chore assigned 🏠',
      body: `You've been assigned: ${record.name}`,
      data: { choreId: record.id },
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(message),
    })

    const result = await response.json()
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(String(e), { status: 500 })
  }
})
