-- supabase/migrations/20260703000005_add_point_value_to_chores.sql
alter table public.chores
  add column point_value integer not null default 10
  check (point_value > 0);
