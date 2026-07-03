-- Remove the 31-day cap on house goal target_days so users can set longer deadlines.
alter table public.house_monthly_goals
  drop constraint if exists house_monthly_goals_target_days_check;
