import { todayLocalISO, offsetDate } from '@/lib/dateUtils'

describe('todayLocalISO', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('matches local date getters', () => {
    const d = new Date()
    const expected = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-')
    expect(todayLocalISO()).toBe(expected)
  })
})

describe('offsetDate', () => {
  it('adds positive days', () => {
    expect(offsetDate('2026-06-28', 3)).toBe('2026-07-01')
  })

  it('subtracts negative days', () => {
    expect(offsetDate('2026-07-01', -3)).toBe('2026-06-28')
  })

  it('handles month-end rollover', () => {
    expect(offsetDate('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('zero offset returns the same date', () => {
    expect(offsetDate('2026-06-15', 0)).toBe('2026-06-15')
  })
})
