-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  avatar_color_index integer not null default 0 check (avatar_color_index between 0 and 7),
  timezone     text not null default 'UTC',
  push_token   text,
  created_at   timestamptz not null default now()
);

-- Houses
create table public.houses (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  code       text not null unique
);
create index on public.houses(code);

-- House members (one house per user enforced by UNIQUE)
create table public.house_members (
  id        uuid primary key default uuid_generate_v4(),
  house_id  uuid not null references public.houses(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique(user_id)
);
create index on public.house_members(house_id);

-- Chores
create type public.chore_frequency as enum ('daily', 'weekly');

create table public.chores (
  id          uuid primary key default uuid_generate_v4(),
  house_id    uuid not null references public.houses(id) on delete cascade,
  created_by  uuid not null references public.profiles(id),
  name        text not null,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_date    date,
  notes       text,
  frequency   public.chore_frequency not null,
  created_at  timestamptz not null default now()
);
create index on public.chores(house_id);
create index on public.chores(assigned_to);

-- Chore completions (one per chore per day)
create table public.chore_completions (
  id           uuid primary key default uuid_generate_v4(),
  chore_id     uuid not null references public.chores(id) on delete cascade,
  completed_by uuid not null references public.profiles(id),
  completed_at timestamptz not null default now(),
  for_date     date not null,
  unique(chore_id, for_date)
);
create index on public.chore_completions(chore_id);
create index on public.chore_completions(for_date);
