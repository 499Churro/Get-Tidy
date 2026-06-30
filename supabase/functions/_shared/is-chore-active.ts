export interface ChoreRow {
  due_date: string | null
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  days_of_week: number[] | null
  created_at: string
  archived_at?: string | null  // ISO timestamptz string
}

export function isChoreActiveOnDate(
  chore: ChoreRow,
  localDate: string,      // YYYY-MM-DD
  localDayOfWeek: number  // 0=Sun…6=Sat
): boolean {
  // Archive guard — date-aware. Dates before archive evaluate normally.
  if (chore.archived_at) {
    const archivedDate = chore.archived_at.slice(0, 10)
    if (localDate >= archivedDate) return false
  }

  if (chore.due_date) return chore.due_date === localDate
  if (chore.created_at.slice(0, 10) > localDate) return false

  if (chore.frequency === 'daily') return true

  if (chore.frequency === 'weekly') {
    if (chore.days_of_week?.length) return chore.days_of_week.includes(localDayOfWeek)
    return true // legacy: no days_of_week means all week
  }

  if (chore.frequency === 'biweekly') {
    if (!chore.days_of_week?.length || !chore.days_of_week.includes(localDayOfWeek)) return false
    const creationMonday = getMondayOfWeek(chore.created_at.slice(0, 10))
    const currentMonday = getMondayOfWeek(localDate)
    const weeksDiff = Math.round(
      (new Date(currentMonday).getTime() - new Date(creationMonday).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
    )
    return weeksDiff >= 0 && weeksDiff % 2 === 0
  }

  if (chore.frequency === 'monthly') {
    if (!chore.days_of_week?.length || !chore.days_of_week.includes(localDayOfWeek)) return false
    const date = new Date(localDate + 'T00:00:00Z')
    const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    const firstDow = firstOfMonth.getUTCDay()
    const daysUntil = (localDayOfWeek - firstDow + 7) % 7
    const firstOccurrence = new Date(firstOfMonth)
    firstOccurrence.setUTCDate(1 + daysUntil)
    return date.getUTCDate() === firstOccurrence.getUTCDate()
  }

  return false
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}
