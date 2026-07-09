import { Chore, ChoreCompletion } from '@/types/database'

export function isChoreCompleteForDate(
  choreId: string,
  forDate: string,
  completions: ChoreCompletion[]
): boolean {
  return completions.some(c => c.chore_id === choreId && c.for_date === forDate)
}

export function getMondayOfWeek(dateStr: string): string {
  const date = new Date(dateStr)
  const day = date.getUTCDay() // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setUTCDate(date.getUTCDate() + diff)
  return monday.toISOString().slice(0, 10)
}

export function getChoresForDay(chores: Chore[], forDate: string): Chore[] {
  const date = new Date(forDate)
  const dayOfWeek = date.getUTCDay() // 0=Sun … 6=Sat
  const monday = getMondayOfWeek(forDate)

  return chores.filter(chore => {
    // One-off: show only on the specified date (can be in the past or future)
    if (chore.due_date) return chore.due_date === forDate

    // Repeating: never show on dates before the chore was created.
    // Use the UTC date portion of created_at (consistent with how biweekly uses .slice(0,10)).
    if (forDate < chore.created_at.slice(0, 10)) return false

    // Legacy daily — show every day
    if (chore.frequency === 'daily') return true

    const dow = chore.days_of_week

    if (chore.frequency === 'weekly') {
      if (dow?.length) return dow.includes(dayOfWeek)
      const mondayDate = new Date(monday)
      const sunday = new Date(mondayDate)
      sunday.setUTCDate(mondayDate.getUTCDate() + 6)
      return date >= mondayDate && date <= sunday
    }

    if (chore.frequency === 'biweekly') {
      if (!dow?.length || !dow.includes(dayOfWeek)) return false
      // Count weeks since chore creation week — show on even weeks (0, 2, 4...)
      const creationMonday = getMondayOfWeek(chore.created_at.slice(0, 10))
      const creationMs = new Date(creationMonday).getTime()
      const currentMs = new Date(monday).getTime()
      const weeksDiff = Math.round((currentMs - creationMs) / (7 * 24 * 60 * 60 * 1000))
      return weeksDiff >= 0 && weeksDiff % 2 === 0
    }

    if (chore.frequency === 'monthly') {
      if (!dow?.length || !dow.includes(dayOfWeek)) return false
      // Show on the first occurrence of this weekday in each month
      const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
      const firstDow = firstOfMonth.getUTCDay()
      const daysUntil = (dayOfWeek - firstDow + 7) % 7
      const firstOccurrence = new Date(firstOfMonth)
      firstOccurrence.setUTCDate(1 + daysUntil)
      return date.getUTCDate() === firstOccurrence.getUTCDate()
    }

    return false
  })
}

export function getProgressDotColor(
  assignedChoresForDay: Chore[],
  completions: ChoreCompletion[],
  forDate: string
): 'red' | 'orange' | 'yellow' | 'green' | null {
  if (assignedChoresForDay.length === 0) return null
  const doneCount = assignedChoresForDay.filter(c =>
    isChoreCompleteForDate(c.id, forDate, completions)
  ).length
  const ratio = doneCount / assignedChoresForDay.length
  if (ratio === 1) return 'green'
  if (ratio >= 0.5) return 'yellow'
  if (ratio > 0) return 'orange'
  return 'red'
}

export function sortChores(
  chores: Chore[],
  completions: ChoreCompletion[],
  forDate: string
): Chore[] {
  return [...chores].sort((a, b) => {
    const aDone = isChoreCompleteForDate(a.id, forDate, completions)
    const bDone = isChoreCompleteForDate(b.id, forDate, completions)
    if (aDone !== bDone) return aDone ? 1 : -1
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return a.created_at.localeCompare(b.created_at)
  })
}
