import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller via their JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { name, avatarColorIndex, houseId, password } = await req.json()
    if (!name || !houseId || !password) {
      return new Response(JSON.stringify({ error: 'name, houseId, and password are required' }), { status: 400, headers: corsHeaders })
    }

    // Verify caller is admin of the house
    const { data: membership } = await adminClient
      .from('house_members')
      .select('role')
      .eq('house_id', houseId)
      .eq('user_id', caller.id)
      .single()
    if (membership?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can create managed profiles' }), { status: 403, headers: corsHeaders })
    }

    // Generate unique managed email
    const uniqueId = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    const email = `managed-${uniqueId}@tidy.local`

    // Create auth user
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    })
    if (createErr || !newUser.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? 'Failed to create user' }), { status: 500, headers: corsHeaders })
    }

    const userId = newUser.user.id

    // Upsert profile
    await adminClient.from('profiles').upsert({
      id: userId,
      display_name: name,
      avatar_color_index: avatarColorIndex ?? 0,
      timezone: 'America/Los_Angeles',
    })

    // Add to house
    await adminClient.from('house_members').insert({
      house_id: houseId,
      user_id: userId,
      role: 'member',
    })

    return new Response(JSON.stringify({ userId, email }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
