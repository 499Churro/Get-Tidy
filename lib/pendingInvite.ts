// Persisted store for a pending house invite code.
// Survives OAuth redirects, app cold starts, and React strict-mode double renders.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'tidy:pending_invite_code'

export async function setPendingInviteCode(code: string): Promise<void> {
  await AsyncStorage.setItem(KEY, code)
}

export async function consumePendingInviteCode(): Promise<string | null> {
  const code = await AsyncStorage.getItem(KEY)
  if (code) await AsyncStorage.removeItem(KEY)
  return code
}
