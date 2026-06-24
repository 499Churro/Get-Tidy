export type Frequency = 'daily' | 'weekly'

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
}

export interface HouseMember {
  id: string
  house_id: string
  user_id: string
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
  created_at: string
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
