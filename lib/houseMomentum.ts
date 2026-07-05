import { HouseMomentum } from '@/types/database'

export function getRecapCopy(m: HouseMomentum): string {
  const remaining = m.target_days - m.active_days
  if (m.active_days >= m.target_days) {
    return m.reward_text ? `${m.reward_text} unlocked. Well done.` : 'Goal reached. Well done.'
  }
  if (remaining <= 3) {
    return m.reward_text
      ? `So close — ${remaining} more day${remaining === 1 ? '' : 's'} to ${m.reward_text}.`
      : `${remaining} more day${remaining === 1 ? '' : 's'} to go.`
  }
  return m.reward_text
    ? `${m.active_days} days in. ${m.reward_text} is in reach.`
    : `${m.active_days} days in this month.`
}
