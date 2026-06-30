import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isChoreActiveOnDate } from '../_shared/is-chore-active.ts'

function dateToYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysInRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T00:00:00Z')
  const last = new Date(end + 'T00:00:00Z')
  while (cur <= last) {
    days.push(dateToYMD(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

serve(async (req) => {
  // ── 1. Verify JWT ──────────────────────────────────────────────────────────
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jwt) return new Response('Unauthorized', { status: 401 })

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  // ── 2. Parse request ───────────────────────────────────────────────────────
  const { house_id, month } = await req.json() as { house_id: string; month: string }
  if (!house_id || !month) return new Response('Bad Request', { status: 400 })

  // ── 3. Verify caller is a house member ────────────────────────────────────
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { count: memberCount } = await admin
    .from('house_members')
    .select('*', { count: 'exact', head: true })
    .eq('house_id', house_id)
    .eq('user_id', user.id)

  if (!memberCount) return new Response('Forbidden', { status: 403 })

  const { data: membersData } = await admin
    .from('house_members')
    .select('user_id')
    .eq('house_id', house_id)
  const memberIds = new Set((membersData ?? []).map((m: { user_id: string }) => m.user_id))

  // ── 4. Compute month boundaries ───────────────────────────────────────────
  const monthStart = month.slice(0, 7) + '-01'
  const monthDate = new Date(monthStart + 'T00:00:00Z')
  const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0))
  const monthEndStr = dateToYMD(monthEnd)
  const today = dateToYMD(new Date())
  const evalEnd = today < monthEndStr ? today : monthEndStr

  // ── 5. Fetch chores active at any point in this month ─────────────────────
  const { data: chores } = await admin
    .from('chores')
    .select('id, due_date, frequency, days_of_week, created_at, archived_at, assigned_to')
    .eq('house_id', house_id)
    .or(`archived_at.is.null,archived_at.gte.${monthStart}`)

  if (!chores) return new Response('Internal Error', { status: 500 })

  // ── 6. Early return if no chores in this month ────────────────────────────
  if (chores.length === 0) {
    const { data: goal } = await admin
      .from('house_monthly_goals')
      .select('reward_text, target_pct, goal_type, target_days')
      .eq('house_id', house_id)
      .eq('month', monthStart)
      .maybeSingle()
    return new Response(JSON.stringify({
      on_time_completions: 0,
      expected_completions: 0,
      momentum_pct: 0,
      reward_text: goal?.reward_text ?? null,
      target_pct: goal?.target_pct ?? 90,
      active_days: 0,
      target_days: goal?.target_days ?? 20,
      goal_type: goal?.goal_type ?? 'days',
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 })
  }

  // ── 7. Build expected occurrences ─────────────────────────────────────────
  let expectedCompletions = 0
  const choreIdSet = new Set(chores.map(c => c.id))

  for (const chore of chores) {
    const choreStart = chore.created_at.slice(0, 10) > monthStart
      ? chore.created_at.slice(0, 10)
      : monthStart
    const days = daysInRange(choreStart, evalEnd)
    for (const day of days) {
      const dow = new Date(day + 'T00:00:00Z').getUTCDay()
      if (isChoreActiveOnDate(chore, day, dow)) expectedCompletions++
    }
  }

  // ── 8. Fetch completions in this month for this house ─────────────────────
  const { data: completions } = await admin
    .from('chore_completions')
    .select('chore_id, for_date, completed_by')
    .in('chore_id', [...choreIdSet])
    .gte('for_date', monthStart)
    .lte('for_date', evalEnd)

  // ── 9. Count on-time completions ──────────────────────────────────────────
  const choreMap = new Map(chores.map(c => [c.id, c]))
  let onTimeCompletions = 0

  for (const comp of completions ?? []) {
    const chore = choreMap.get(comp.chore_id)
    if (!chore) continue
    const dow = new Date(comp.for_date + 'T00:00:00Z').getUTCDay()
    if (isChoreActiveOnDate(chore, comp.for_date, dow)) {
      onTimeCompletions++
    }
  }

  // ── 9b. Count active days ─────────────────────────────────────────────────
  const completionsByDate = new Map<string, Set<string>>()
  for (const comp of completions ?? []) {
    if (!completionsByDate.has(comp.for_date)) completionsByDate.set(comp.for_date, new Set())
    completionsByDate.get(comp.for_date)!.add(comp.completed_by)
  }

  let activeDays = 0
  const allDays = daysInRange(monthStart, evalEnd)
  for (const day of allDays) {
    const dow = new Date(day + 'T00:00:00Z').getUTCDay()
    const membersWithChores = new Set<string>()
    for (const chore of chores) {
      if (chore.assigned_to && memberIds.has(chore.assigned_to) && isChoreActiveOnDate(chore, day, dow)) {
        membersWithChores.add(chore.assigned_to)
      }
    }
    if (membersWithChores.size === 0) continue
    const dayCompletions = completionsByDate.get(day) ?? new Set<string>()
    const allDone = [...membersWithChores].every(uid => dayCompletions.has(uid))
    if (allDone) activeDays++
  }

  // ── 10. Fetch goal ────────────────────────────────────────────────────────
  const { data: goal } = await admin
    .from('house_monthly_goals')
    .select('reward_text, target_pct, goal_type, target_days')
    .eq('house_id', house_id)
    .eq('month', monthStart)
    .maybeSingle()

  const momentumPct = expectedCompletions === 0
    ? 0
    : Math.round((onTimeCompletions / expectedCompletions) * 100)

  return new Response(JSON.stringify({
    on_time_completions: onTimeCompletions,
    expected_completions: expectedCompletions,
    momentum_pct: momentumPct,
    reward_text: goal?.reward_text ?? null,
    target_pct: goal?.target_pct ?? 90,
    active_days: activeDays,
    target_days: goal?.target_days ?? 20,
    goal_type: goal?.goal_type ?? 'days',
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
