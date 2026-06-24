import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { registerForPushNotifications } from '@/lib/notifications'
import { House, HouseMember } from '@/types/database'

export function useHouse(userId: string | undefined) {
  const [house, setHouse] = useState<House | null>(null)
  const [members, setMembers] = useState<HouseMember[]>([])
  const [loading, setLoading] = useState(true)

  const fetchHouse = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    setLoading(true)
    const { data: membership } = await supabase
      .from('house_members')
      .select('house_id')
      .eq('user_id', userId)
      .single()

    if (!membership) { setHouse(null); setMembers([]); setLoading(false); return }

    const [{ data: houseData }, { data: membersData }] = await Promise.all([
      supabase.from('houses').select('*').eq('id', membership.house_id).single(),
      supabase.from('house_members').select('*, profile:profiles(*)').eq('house_id', membership.house_id),
    ])

    setHouse(houseData)
    setMembers((membersData ?? []) as HouseMember[])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    fetchHouse()
    if (!userId) return
    const channel = supabase
      .channel(`house_members:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'house_members' }, fetchHouse)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, fetchHouse])

  async function createHouse(name: string): Promise<{ error: string | null }> {
    const code = generateCode()
    const { data, error } = await supabase
      .from('houses')
      .insert({ name, created_by: userId, code })
      .select()
      .single()
    if (error) return { error: error.message }
    const { error: memberError } = await supabase
      .from('house_members')
      .insert({ house_id: data.id, user_id: userId })
    if (userId) registerForPushNotifications(userId).catch(() => {})
    return { error: memberError?.message ?? null }
  }

  async function joinHouse(code: string): Promise<{ error: string | null }> {
    const { data: foundHouse, error: findError } = await supabase
      .from('houses')
      .select('id')
      .eq('code', code.toUpperCase())
      .single()
    if (findError || !foundHouse) return { error: 'House not found. Check your code and try again.' }
    const { error } = await supabase
      .from('house_members')
      .insert({ house_id: foundHouse.id, user_id: userId })
    if (error?.code === '23505') return { error: "You're already in a house. Leave your current house first." }
    if (userId) registerForPushNotifications(userId).catch(() => {})
    return { error: error?.message ?? null }
  }

  async function leaveHouse(): Promise<{ error: string | null }> {
    if (house) {
      await supabase
        .from('chores')
        .update({ assigned_to: null })
        .eq('house_id', house.id)
        .eq('assigned_to', userId)
    }
    const { error } = await supabase.from('house_members').delete().eq('user_id', userId)
    return { error: error?.message ?? null }
  }

  return { house, members, loading, createHouse, joinHouse, leaveHouse, refetch: fetchHouse }
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return 'TIDY-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
