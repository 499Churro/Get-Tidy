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

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })

    const { targetUserId } = await req.json()
    if (!targetUserId) return new Response(JSON.stringify({ error: 'targetUserId required' }), { status: 400, headers: corsHeaders })

    // Verify target is a managed profile (email ends in @tidy.local)
    const { data: targetUser } = await adminClient.auth.admin.getUserById(targetUserId)
    if (!targetUser?.user?.email?.endsWith('@tidy.local')) {
      return new Response(JSON.stringify({ error: 'Target is not a managed profile' }), { status: 400, headers: corsHeaders })
    }

    // Verify caller is admin of the same house as the target
    const { data: targetMembership } = await adminClient
      .from('house_members')
      .select('house_id')
      .eq('user_id', targetUserId)
      .single()
    if (!targetMembership) return new Response(JSON.stringify({ error: 'Target not in any house' }), { status: 404, headers: corsHeaders })

    const { data: callerMembership } = await adminClient
      .from('house_members')
      .select('role')
      .eq('house_id', targetMembership.house_id)
      .eq('user_id', caller.id)
      .single()
    if (callerMembership?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can remove managed profiles' }), { status: 403, headers: corsHeaders })
    }

    // Delete the auth user — cascades to profiles + house_members
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(targetUserId)
    if (deleteErr) return new Response(JSON.stringify({ error: deleteErr.message }), { status: 500, headers: corsHeaders })

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
