import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Chore, ChoreCompletion, ChoreWithCompletion, Frequency } from '@/types/database'
import { getChoresForDay, sortChores } from '@/lib/chores'
import { scheduleChoreNotifications, cancelChoreNotifications, syncAllChoreNotifications } from '@/lib/scheduleChoreNotifications'
import { offsetDate } from '@/lib/dateUtils'

export function useChores(houseId: string | undefined, selectedDate: string) {
  const [chores, setChores] = useState<Chore[]>([])
  const [completions, setCompletions] = useState<ChoreCompletion[]>([])
  const [loading, setLoading] = useState(true)
  const pendingRef = useRef<Set<string>>(new Set())

  const fetchAll = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)

    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const { data: choreData } = await supabase
      .from('chores')
      .select('*, assigned_profile:profiles!assigned_to(*)')
      .eq('house_id', houseId)
      .is('archived_at', null)
      .or(`due_date.is.null,due_date.gte.${todayStr}`)

    const choreIds = (choreData ?? []).map(c => c.id)
    const windowStart = offsetDate(selectedDate, -7)
    const windowEnd   = offsetDate(selectedDate,  7)
    const { data: completionData } = choreIds.length > 0
      ? await supabase
          .from('chore_completions')
          .select('*')
          .in('chore_id', choreIds)
          .gte('for_date', windowStart)
          .lte('for_date', windowEnd)
      : { data: [] }

    const typedChores = (choreData ?? []) as Chore[]
    setChores(typedChores)
    setCompletions(completionData ?? [])
    setLoading(false)
    // Re-sync local notifications whenever chores are refreshed
    syncAllChoreNotifications(typedChores).catch(() => {})
  }, [houseId, selectedDate])

  useEffect(() => {
    fetchAll()
    if (!houseId) return
    const channel = supabase
      .channel(`chores:${houseId}:${Date.now()}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chores',
        filter: `house_id=eq.${houseId}`
      }, fetchAll)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chore_completions'
      }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [houseId, fetchAll])

  // Returns chores for selected day with completion status, optionally filtered by userId
  function getChoresForSelectedDay(filterUserId?: string): ChoreWithCompletion[] {
    let dayChores = getChoresForDay(chores, selectedDate)
    if (filterUserId !== undefined) {
      dayChores = dayChores.filter(c => c.assigned_to === filterUserId || c.assigned_to === null)
    }
    const sorted = sortChores(dayChores, completions, selectedDate)
    return sorted.map(chore => ({
      ...chore,
      completion: completions.find(
        c => c.chore_id === chore.id && c.for_date === selectedDate
      ) ?? null,
    }))
  }

  async function markDone(choreId: string, userId: string): Promise<void> {
    // Shared key with undoMarkDone — blocks undo while insert is in flight and vice versa
    const key = `${choreId}:${selectedDate}`
    if (pendingRef.current.has(key)) return
    pendingRef.current.add(key)

    const optimistic: ChoreCompletion = {
      id: `optimistic-${key}`,
      chore_id: choreId,
      completed_by: userId,
      completed_at: new Date().toISOString(),
      for_date: selectedDate,
    }
    setCompletions(prev => [...prev, optimistic])

    let succeeded = false
    try {
      const result = await supabase.from('chore_completions').insert({
        chore_id: choreId,
        completed_by: userId,
        for_date: selectedDate,
      })
      if (!result.error) succeeded = true
    } catch {
      // network/SDK throw — treat as failure, rollback below
    } finally {
      pendingRef.current.delete(key)
    }

    if (!succeeded) {
      setCompletions(prev => prev.filter(c => c.id !== optimistic.id))
    }
  }

  async function undoMarkDone(choreId: string): Promise<void> {
    const key = `${choreId}:${selectedDate}`
    if (pendingRef.current.has(key)) return
    pendingRef.current.add(key)

    const snapshot = completions.filter(
      c => c.chore_id === choreId && c.for_date === selectedDate
    )
    setCompletions(prev =>
      prev.filter(c => !(c.chore_id === choreId && c.for_date === selectedDate))
    )

    try {
      const { error } = await supabase.rpc('undo_chore_completion', {
        p_chore_id: choreId,
        p_for_date: selectedDate,
      })
      if (error) {
        setCompletions(prev => [...prev, ...snapshot])
      }
    } catch {
      setCompletions(prev => [...prev, ...snapshot])
    } finally {
      pendingRef.current.delete(key)
    }
  }

  async function addChore(params: {
    name: string
    assignedTo: string | null
    dueDate: string | null
    notes: string | null
    frequency: Frequency
    daysOfWeek: number[] | null
    reminderTime: string | null
    rotationEnabled: boolean
    houseId: string
    createdBy: string
  }): Promise<{ error: string | null }> {
    const { error } = await supabase.from('chores').insert({
      name: params.name,
      assigned_to: params.assignedTo,
      due_date: params.dueDate,
      notes: params.notes,
      frequency: params.frequency,
      days_of_week: params.daysOfWeek,
      reminder_time: params.reminderTime,
      rotation_enabled: params.rotationEnabled,
      house_id: params.houseId,
      created_by: params.createdBy,
    })
    if (!error) await fetchAll()
    return { error: error?.message ?? null }
  }

  async function updateChore(
    choreId: string,
    updates: {
      name?: string
      assignedTo?: string | null
      dueDate?: string | null
      notes?: string | null
      frequency?: Frequency
      daysOfWeek?: number[] | null
      reminderTime?: string | null
      rotationEnabled?: boolean
    }
  ): Promise<{ error: string | null }> {
    const patch: Record<string, unknown> = {}
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.assignedTo !== undefined) patch.assigned_to = updates.assignedTo
    if (updates.dueDate !== undefined) patch.due_date = updates.dueDate
    if (updates.notes !== undefined) patch.notes = updates.notes
    if (updates.frequency !== undefined) patch.frequency = updates.frequency
    if (updates.daysOfWeek !== undefined) patch.days_of_week = updates.daysOfWeek
    if (updates.reminderTime !== undefined) patch.reminder_time = updates.reminderTime
    if (updates.rotationEnabled !== undefined) patch.rotation_enabled = updates.rotationEnabled
    const { error } = await supabase.from('chores').update(patch).eq('id', choreId)
    if (!error) await fetchAll()
    return { error: error?.message ?? null }
  }

  async function deleteChore(choreId: string): Promise<{ error: string | null }> {
    const { error } = await supabase
      .from('chores')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', choreId)
    if (!error) {
      cancelChoreNotifications(choreId).catch(() => {})
      await fetchAll()
    }
    return { error: error?.message ?? null }
  }

  return {
    chores,
    completions,
    loading,
    getChoresForSelectedDay,
    markDone,
    undoMarkDone,
    addChore,
    updateChore,
    deleteChore,
    refetch: fetchAll,
  }
}
