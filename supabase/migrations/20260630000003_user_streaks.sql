-- supabase/migrations/20260630000003_user_streaks.sql

create table if not exists public.user_streaks (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  current_streak   integer not null default 0,
  longest_streak   integer not null default 0,
  last_active_date date,
  updated_at       timestamptz not null default now()
);

alter table public.user_streaks enable row level security;

-- Users can only read their own streak (personal, not shared)
create policy "own streak read"
  on public.user_streaks for select
  using (user_id = auth.uid());

-- No client writes — written by evaluate-streaks Edge Function only
