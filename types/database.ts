export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly'

export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  avatar_color_index: number
  timezone: string
  push_token: string | null
  created_at: string
}

export interface House {
  id: string
  name: string
  created_by: string
  created_at: string
  code: string
  rotation_enabled: boolean
}

export interface HouseMember {
  id: string
  house_id: string
  user_id: string
  role: 'admin' | 'member'
  joined_at: string
  profile?: Profile
}

export interface Chore {
  id: string
  house_id: string
  created_by: string
  name: string
  assigned_to: string | null
  due_date: string | null
  notes: string | null
  frequency: Frequency
  days_of_week: number[] | null
  reminder_time: string | null
  archived_at: string | null
  created_at: string
  rotation_enabled: boolean
  assigned_profile?: Profile
}

export interface ChoreCompletion {
  id: string
  chore_id: string
  completed_by: string
  completed_at: string
  for_date: string
}

export interface ChoreWithCompletion extends Chore {
  completion: ChoreCompletion | null
}

export interface UserStreak {
  user_id: string
  current_streak: number
  longest_streak: number
  last_active_date: string | null  // YYYY-MM-DD
  updated_at: string
}

export interface HouseMonthlyGoal {
  id: string
  house_id: string
  month: string           // YYYY-MM-DD, first of month
  reward_text: string
  target_pct: number
  goal_type: 'days' | 'percentage'
  target_days: number
  created_at: string
  updated_at: string
}

export interface HouseMomentum {
  on_time_completions: number
  expected_completions: number
  momentum_pct: number
  reward_text: string | null
  target_pct: number
  active_days: number
  target_days: number
  goal_type: 'days' | 'percentage'
}

export interface PersonalMomentum {
  active_days: number
  target_days: number
  reward_text: string | null
  has_goal: boolean
}
