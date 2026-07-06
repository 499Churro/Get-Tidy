import { supabase } from '@/lib/supabase'
import { registerForPushNotifications } from '@/lib/notifications'
import { notifyHouseMembershipChanged } from '@/lib/house-events'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return 'TIDY-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function createHouse(userId: string, name: string): Promise<{ error: string | null }> {
  const code = generateCode()
  const { data, error } = await supabase
    .from('houses')
    .insert({ name, created_by: userId, code })
    .select()
    .single()
  if (error) return { error: error.message }
  const { error: memberError } = await supabase
    .from('house_members')
    .insert({ house_id: data.id, user_id: userId, role: 'admin' })
  if (!memberError) notifyHouseMembershipChanged()
  if (userId) registerForPushNotifications(userId).catch(() => {})
  return { error: memberError?.message ?? null }
}

export async function joinHouse(userId: string, code: string): Promise<{ error: string | null }> {
  // Use security-definer RPC to bypass RLS — unjoined users cannot SELECT from houses
  const { data, error: rpcError } = await supabase.rpc('join_house_by_code', {
    code_input: code.toUpperCase(),
  })
  if (rpcError) return { error: rpcError.message }
  const result = data as { house_id: string | null; error: string | null }
  if (result.error) return { error: result.error }
  notifyHouseMembershipChanged()
  if (userId) registerForPushNotifications(userId).catch(() => {})
  return { error: null }
}
