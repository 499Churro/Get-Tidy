import { getChoresForDay, getProgressDotColor, isChoreCompleteForDate, getMondayOfWeek, sortChores } from '@/lib/chores'
import { Chore, ChoreCompletion } from '@/types/database'

const baseChore: Chore = {
  id: '1',
  house_id: 'h1',
  created_by: 'u1',
  name: 'Sweep kitchen',
  assigned_to: 'u1',
  due_date: null,
  notes: null,
  frequency: 'daily',
  days_of_week: null,
  reminder_time: null,
  created_at: '2026-06-22T00:00:00Z',
}

const mondayDate = '2026-06-22' // Known Monday
const tuesdayDate = '2026-06-23' // Known Tuesday
const wednesdayDate = '2026-06-24' // Known Wednesday
const sundayDate = '2026-06-28' // Known Sunday

describe('getMondayOfWeek', () => {
  it('returns the Monday for a Monday input', () => {
    expect(getMondayOfWeek(mondayDate)).toBe('2026-06-22')
  })

  it('returns the Monday for a Tuesday input', () => {
    expect(getMondayOfWeek(tuesdayDate)).toBe('2026-06-22')
  })

  it('returns the Monday for a Sunday input', () => {
    expect(getMondayOfWeek(sundayDate)).toBe('2026-06-22')
  })
})

describe('isChoreCompleteForDate', () => {
  it('returns true when a completion exists for the date', () => {
    const completions: ChoreCompletion[] = [{
      id: 'c1', chore_id: '1', completed_by: 'u1',
      completed_at: '2026-06-23T10:00:00Z', for_date: '2026-06-23'
    }]
    expect(isChoreCompleteForDate('1', '2026-06-23', completions)).toBe(true)
  })

  it('returns false when no completion exists for the date', () => {
    expect(isChoreCompleteForDate('1', '2026-06-23', [])).toBe(false)
  })

  it('returns false when completion exists for a different date', () => {
    const completions: ChoreCompletion[] = [{
      id: 'c1', chore_id: '1', completed_by: 'u1',
      completed_at: '2026-06-22T10:00:00Z', for_date: '2026-06-22'
    }]
    expect(isChoreCompleteForDate('1', '2026-06-23', completions)).toBe(false)
  })
})

describe('getChoresForDay', () => {
  it('returns daily chores for any day', () => {
    const chores = [{ ...baseChore, frequency: 'daily' as const }]
    expect(getChoresForDay(chores, tuesdayDate)).toHaveLength(1)
    expect(getChoresForDay(chores, mondayDate)).toHaveLength(1)
  })

  it('one-time chore (has due_date) appears only on that exact date', () => {
    const chores = [{ ...baseChore, frequency: 'weekly' as const, due_date: tuesdayDate }]
    expect(getChoresForDay(chores, tuesdayDate)).toHaveLength(1)
    expect(getChoresForDay(chores, mondayDate)).toHaveLength(0)
    expect(getChoresForDay(chores, wednesdayDate)).toHaveLength(0)
  })

  it('returns empty for one-time chore on a non-matching day', () => {
    const chores = [{ ...baseChore, frequency: 'weekly' as const, due_date: '2026-06-24' }]
    expect(getChoresForDay(chores, mondayDate)).toHaveLength(0)
  })

  it('weekly chore with days_of_week [1,3] appears on Mon and Wed only', () => {
    const chores = [{ ...baseChore, frequency: 'weekly' as const, days_of_week: [1, 3] }]
    expect(getChoresForDay(chores, mondayDate)).toHaveLength(1)
    expect(getChoresForDay(chores, wednesdayDate)).toHaveLength(1)
    expect(getChoresForDay(chores, tuesdayDate)).toHaveLength(0)
    expect(getChoresForDay(chores, sundayDate)).toHaveLength(0)
  })

  it('weekly chore with days_of_week: null appears all week (legacy fallback)', () => {
    const chores = [{ ...baseChore, frequency: 'weekly' as const, days_of_week: null }]
    expect(getChoresForDay(chores, mondayDate)).toHaveLength(1)
    expect(getChoresForDay(chores, tuesdayDate)).toHaveLength(1)
    expect(getChoresForDay(chores, sundayDate)).toHaveLength(1)
  })

  it('chore does NOT appear before created_at date', () => {
    const chores = [{ ...baseChore, frequency: 'daily' as const, created_at: '2026-06-25T00:00:00Z' }]
    expect(getChoresForDay(chores, '2026-06-24')).toHaveLength(0)
    expect(getChoresForDay(chores, '2026-06-25')).toHaveLength(1)
    expect(getChoresForDay(chores, '2026-06-26')).toHaveLength(1)
  })
})

describe('getProgressDotColor', () => {
  it('returns null when no assigned chores for the day', () => {
    expect(getProgressDotColor([], [], '2026-06-23')).toBeNull()
  })

  it('returns red when 0% complete', () => {
    const chores = [baseChore]
    expect(getProgressDotColor(chores, [], '2026-06-23')).toBe('red')
  })

  it('returns green when 100% complete', () => {
    const chores = [baseChore]
    const completions: ChoreCompletion[] = [{ id: 'c1', chore_id: '1', completed_by: 'u1', completed_at: '', for_date: '2026-06-23' }]
    expect(getProgressDotColor(chores, completions, '2026-06-23')).toBe('green')
  })

  it('returns orange when 25% complete (1 of 4)', () => {
    const chores = [
      baseChore,
      { ...baseChore, id: '2' },
      { ...baseChore, id: '3' },
      { ...baseChore, id: '4' },
    ]
    const completions: ChoreCompletion[] = [{ id: 'c1', chore_id: '1', completed_by: 'u1', completed_at: '', for_date: '2026-06-23' }]
    expect(getProgressDotColor(chores, completions, '2026-06-23')).toBe('orange')
  })

  it('returns yellow when 50% complete (1 of 2)', () => {
    const chores = [baseChore, { ...baseChore, id: '2' }]
    const completions: ChoreCompletion[] = [{ id: 'c1', chore_id: '1', completed_by: 'u1', completed_at: '', for_date: '2026-06-23' }]
    expect(getProgressDotColor(chores, completions, '2026-06-23')).toBe('yellow')
  })
})

describe('sortChores', () => {
  it('puts incomplete chores before complete ones', () => {
    const chores: Chore[] = [
      { ...baseChore, id: '1' },
      { ...baseChore, id: '2' },
    ]
    const completions: ChoreCompletion[] = [{ id: 'c1', chore_id: '2', completed_by: 'u1', completed_at: '', for_date: '2026-06-23' }]
    const sorted = sortChores(chores, completions, '2026-06-23')
    expect(sorted[0].id).toBe('1')
    expect(sorted[1].id).toBe('2')
  })
})
