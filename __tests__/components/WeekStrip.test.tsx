import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { WeekStrip } from '@/components/chores/WeekStrip'

const mockDotColors: Record<string, 'red' | 'orange' | 'yellow' | 'green' | null> = {
  '2026-06-22': 'green',
  '2026-06-23': 'yellow',
  '2026-06-24': 'red',
}

describe('WeekStrip', () => {
  it('renders 7 days', () => {
    const { getAllByTestId } = render(
      <WeekStrip
        selectedDate="2026-06-23"
        onSelectDate={jest.fn()}
        dotColors={mockDotColors}
      />
    )
    expect(getAllByTestId('week-day')).toHaveLength(7)
  })

  it('calls onSelectDate with the Monday of the week when first day is tapped', () => {
    const onSelect = jest.fn()
    const { getAllByTestId } = render(
      <WeekStrip
        selectedDate="2026-06-23"
        onSelectDate={onSelect}
        dotColors={mockDotColors}
      />
    )
    fireEvent.press(getAllByTestId('week-day')[0])
    expect(onSelect).toHaveBeenCalledWith('2026-06-22') // Monday
  })

  it('calls onSelectDate with correct date for last day (Sunday)', () => {
    const onSelect = jest.fn()
    const { getAllByTestId } = render(
      <WeekStrip
        selectedDate="2026-06-22"
        onSelectDate={onSelect}
        dotColors={{}}
      />
    )
    fireEvent.press(getAllByTestId('week-day')[6])
    expect(onSelect).toHaveBeenCalledWith('2026-06-28') // Sunday
  })
})
