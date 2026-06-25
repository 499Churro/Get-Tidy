export interface ChoreRow {
  due_date: string | null
  frequency: 'daily' | 'weekly'
  days_of_week: number[] | null
  created_at: string
}

/**
 * Returns true if a chore should be active on the given local date.
 * @param chore          - chore record from the database
 * @param localDate      - YYYY-MM-DD string in the user's local timezone
 * @param localDayOfWeek - 0=Sun … 6=Sat, derived from the same local date
 */
export function isChoreActiveOnDate(
  chore: ChoreRow,
  localDate: string,
  localDayOfWeek: number
): boolean {
  if (chore.due_date) return chore.due_date === localDate
  if (chore.created_at.slice(0, 10) > localDate) return false
  if (chore.frequency === 'daily') return true
  if (chore.frequency === 'weekly') {
    if (chore.days_of_week?.length) return chore.days_of_week.includes(localDayOfWeek)
    return true // legacy: no days_of_week means all week
  }
  return false
}
