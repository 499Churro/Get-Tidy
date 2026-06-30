alter table public.house_monthly_goals
  add column if not exists goal_type text not null default 'days'
    check (goal_type in ('days', 'percentage')),
  add column if not exists target_days integer not null default 20
    check (target_days between 1 and 31);
