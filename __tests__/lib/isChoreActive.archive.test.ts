import { isChoreActiveOnDate } from '../../supabase/functions/_shared/is-chore-active'

const base = {
  due_date: null,
  frequency: 'daily' as const,
  days_of_week: null,
  created_at: '2026-06-01T00:00:00Z',
  archived_at: null,
}

describe('archived_at date-aware guard', () => {
  it('returns true for a date before archived_at', () => {
    const chore = { ...base, archived_at: '2026-06-20T00:00:00Z' }
    expect(isChoreActiveOnDate(chore, '2026-06-19', 4)).toBe(true)
  })

  it('returns false for a date equal to archived_at date', () => {
    const chore = { ...base, archived_at: '2026-06-20T00:00:00Z' }
    expect(isChoreActiveOnDate(chore, '2026-06-20', 5)).toBe(false)
  })

  it('returns false for a date after archived_at', () => {
    const chore = { ...base, archived_at: '2026-06-20T00:00:00Z' }
    expect(isChoreActiveOnDate(chore, '2026-06-25', 3)).toBe(false)
  })

  it('returns true when archived_at is null', () => {
    expect(isChoreActiveOnDate(base, '2026-06-25', 3)).toBe(true)
  })
})
