import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { House, HouseMember } from '@/types/database'
import { createHouse as createHouseRecord, joinHouse as joinHouseRecord } from '@/lib/house'
import { notifyHouseMembershipChanged, subscribeToHouseMembershipChanges } from '@/lib/house-events'

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
    const unsubscribeFromLocalChanges = subscribeToHouseMembershipChanges(fetchHouse)
    const channelName = `house_members:${userId}:${Date.now()}`
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'house_members' }, fetchHouse)
      .subscribe()
    return () => {
      unsubscribeFromLocalChanges()
      supabase.removeChannel(channel)
    }
  }, [userId, fetchHouse])

  async function createHouse(name: string): Promise<{ error: string | null }> {
    if (!userId) return { error: 'You must be signed in to create a house.' }
    const result = await createHouseRecord(userId, name)
    if (!result.error) await fetchHouse()
    return result
  }

  async function joinHouse(code: string): Promise<{ error: string | null }> {
    if (!userId) return { error: 'You must be signed in to join a house.' }
    const result = await joinHouseRecord(userId, code)
    if (!result.error) await fetchHouse()
    return result
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
    if (!error) {
      notifyHouseMembershipChanged()
      await fetchHouse()
    }
    return { error: error?.message ?? null }
  }

  return { house, members, loading, createHouse, joinHouse, leaveHouse, refetch: fetchHouse }
}
