import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Chore, ChoreCompletion, ChoreWithCompletion, Frequency } from '@/types/database'
import { getChoresForDay, isChoreCompleteForDate, sortChores } from '@/lib/chores'

export function useChores(houseId: string | undefined, selectedDate: string) {
  const [chores, setChores] = useState<Chore[]>([])
  const [completions, setCompletions] = useState<ChoreCompletion[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    if (!houseId) { setLoading(false); return }
    setLoading(true)

    const { data: choreData } = await supabase
      .from('chores')
      .select('*, assigned_profile:profiles!assigned_to(*)')
      .eq('house_id', houseId)

    // Fetch all completions for chores in this house
    const choreIds = (choreData ?? []).map(c => c.id)
    const { data: completionData } = choreIds.length > 0
      ? await supabase.from('chore_completions').select('*').in('chore_id', choreIds)
      : { data: [] }

    setChores((choreData ?? []) as Chore[])
    setCompletions(completionData ?? [])
    setLoading(false)
  }, [houseId])

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
      dayChores = dayChores.filter(c => c.assigned_to === filterUserId)
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
    // Optimistic update
    const optimistic: ChoreCompletion = {
      id: `optimistic-${choreId}-${selectedDate}`,
      chore_id: choreId,
      completed_by: userId,
      completed_at: new Date().toISOString(),
      for_date: selectedDate,
    }
    setCompletions(prev => [...prev, optimistic])

    const { error } = await supabase.from('chore_completions').insert({
      chore_id: choreId,
      completed_by: userId,
      for_date: selectedDate,
    })

    if (error) {
      // Rollback
      setCompletions(prev => prev.filter(c => c.id !== optimistic.id))
    }
  }

  async function undoMarkDone(choreId: string): Promise<void> {
    // Optimistic rollback
    setCompletions(prev =>
      prev.filter(c => !(c.chore_id === choreId && c.for_date === selectedDate))
    )
    await supabase
      .from('chore_completions')
      .delete()
      .eq('chore_id', choreId)
      .eq('for_date', selectedDate)
  }

  async function addChore(params: {
    name: string
    assignedTo: string | null
    dueDate: string | null
    notes: string | null
    frequency: Frequency
    daysOfWeek: number[] | null
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
    }
  ): Promise<{ error: string | null }> {
    const patch: Record<string, unknown> = {}
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.assignedTo !== undefined) patch.assigned_to = updates.assignedTo
    if (updates.dueDate !== undefined) patch.due_date = updates.dueDate
    if (updates.notes !== undefined) patch.notes = updates.notes
    if (updates.frequency !== undefined) patch.frequency = updates.frequency
    if (updates.daysOfWeek !== undefined) patch.days_of_week = updates.daysOfWeek
    const { error } = await supabase.from('chores').update(patch).eq('id', choreId)
    if (!error) await fetchAll()
    return { error: error?.message ?? null }
  }

  async function deleteChore(choreId: string): Promise<{ error: string | null }> {
    await supabase.from('chore_completions').delete().eq('chore_id', choreId)
    const { error } = await supabase.from('chores').delete().eq('id', choreId)
    if (!error) await fetchAll()
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
