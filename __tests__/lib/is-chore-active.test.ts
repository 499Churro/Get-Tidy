import { isChoreActiveOnDate, ChoreRow } from '../../supabase/functions/_shared/is-chore-active'

const base: ChoreRow = {
  due_date: null,
  frequency: 'daily',
  days_of_week: null,
  created_at: '2026-06-22T00:00:00Z',
}

// 2026-06-22 is a Monday (dayOfWeek=1), 2026-06-28 is Sunday (0)
const MON = { date: '2026-06-22', dow: 1 }
const TUE = { date: '2026-06-23', dow: 2 }
const WED = { date: '2026-06-24', dow: 3 }
const SUN = { date: '2026-06-28', dow: 0 }

describe('isChoreActiveOnDate — one-time (due_date set)', () => {
  const chore: ChoreRow = { ...base, frequency: 'weekly', due_date: TUE.date }

  it('returns true on the exact due_date', () => {
    expect(isChoreActiveOnDate(chore, TUE.date, TUE.dow)).toBe(true)
  })

  it('returns false on any other date', () => {
    expect(isChoreActiveOnDate(chore, MON.date, MON.dow)).toBe(false)
    expect(isChoreActiveOnDate(chore, WED.date, WED.dow)).toBe(false)
  })
})

describe('isChoreActiveOnDate — daily', () => {
  const chore: ChoreRow = { ...base, frequency: 'daily' }

  it('returns true on any day at or after created_at', () => {
    expect(isChoreActiveOnDate(chore, MON.date, MON.dow)).toBe(true)
    expect(isChoreActiveOnDate(chore, SUN.date, SUN.dow)).toBe(true)
  })

  it('returns false before created_at', () => {
    expect(isChoreActiveOnDate(chore, '2026-06-21', 0)).toBe(false)
  })
})

describe('isChoreActiveOnDate — weekly with days_of_week', () => {
  // Mon=1, Wed=3
  const chore: ChoreRow = { ...base, frequency: 'weekly', days_of_week: [1, 3] }

  it('returns true on a matching weekday', () => {
    expect(isChoreActiveOnDate(chore, MON.date, MON.dow)).toBe(true)
    expect(isChoreActiveOnDate(chore, WED.date, WED.dow)).toBe(true)
  })

  it('returns false on a non-matching weekday', () => {
    expect(isChoreActiveOnDate(chore, TUE.date, TUE.dow)).toBe(false)
    expect(isChoreActiveOnDate(chore, SUN.date, SUN.dow)).toBe(false)
  })

  it('returns false before created_at even on a matching day', () => {
    expect(isChoreActiveOnDate(chore, '2026-06-15', 1)).toBe(false) // Monday before created_at
  })
})

describe('isChoreActiveOnDate — weekly legacy (days_of_week null)', () => {
  const chore: ChoreRow = { ...base, frequency: 'weekly', days_of_week: null }

  it('returns true every day of the week', () => {
    expect(isChoreActiveOnDate(chore, MON.date, MON.dow)).toBe(true)
    expect(isChoreActiveOnDate(chore, TUE.date, TUE.dow)).toBe(true)
    expect(isChoreActiveOnDate(chore, SUN.date, SUN.dow)).toBe(true)
  })

  it('returns false before created_at', () => {
    expect(isChoreActiveOnDate(chore, '2026-06-21', 0)).toBe(false)
  })
})
