-- supabase/migrations/20260630000004_house_monthly_goals.sql

create extension if not exists "uuid-ossp";

create table if not exists public.house_monthly_goals (
  id           uuid primary key default extensions.uuid_generate_v4(),
  house_id     uuid not null references public.houses(id) on delete cascade,
  month        date not null,
  reward_text  text not null,
  target_pct   integer not null default 90 check (target_pct between 1 and 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (house_id, month)
);

alter table public.house_monthly_goals enable row level security;

create policy "house members read goals"
  on public.house_monthly_goals for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

create policy "house members write goals"
  on public.house_monthly_goals for insert
  with check (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

create policy "house members update goals"
  on public.house_monthly_goals for update
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ))
  with check (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));
