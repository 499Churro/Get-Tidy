import React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react-native'
import NoHouseScreen from '@/app/no-house'
import { createHouse, joinHouse } from '@/lib/house'

const mockReplace = jest.fn()
let mockSearchParams: { code?: string } = {}

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
}))

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native')
  return {
    SafeAreaView: View,
  }
})

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    session: { user: { id: 'user-1' } },
  }),
}))

jest.mock('@/lib/house', () => ({
  createHouse: jest.fn(),
  joinHouse: jest.fn(),
}))

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: jest.fn(),
    },
  },
}))

describe('NoHouseScreen', () => {
  beforeEach(() => {
    mockSearchParams = {}
    mockReplace.mockClear()
    jest.mocked(createHouse).mockReset()
    jest.mocked(joinHouse).mockReset()
  })

  it('navigates to the app after creating a house', async () => {
    jest.mocked(createHouse).mockResolvedValue({ error: null })

    const { getByPlaceholderText, getAllByText } = render(<NoHouseScreen />)

    fireEvent.changeText(getByPlaceholderText('House name (e.g. Apt 4B)'), 'Apt 4B')
    fireEvent.press(getAllByText('Create house')[1])

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(app)')
    })
  })

  it('navigates to the app after joining a house', async () => {
    mockSearchParams = { code: 'TIDY-ABCD' }
    jest.mocked(joinHouse).mockResolvedValue({ error: null })

    const { getAllByText } = render(<NoHouseScreen />)

    fireEvent.press(getAllByText('Join house')[1])

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(app)')
    })
  })

  it('does not navigate after a create error', async () => {
    jest.mocked(createHouse).mockResolvedValue({ error: 'nope' })

    const { getByPlaceholderText, getAllByText } = render(<NoHouseScreen />)

    fireEvent.changeText(getByPlaceholderText('House name (e.g. Apt 4B)'), 'Apt 4B')
    fireEvent.press(getAllByText('Create house')[1])

    await waitFor(() => {
      expect(createHouse).toHaveBeenCalled()
    })
    expect(mockReplace).not.toHaveBeenCalledWith('/(app)')
  })
})
