-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.houses enable row level security;
alter table public.house_members enable row level security;
alter table public.chores enable row level security;
alter table public.chore_completions enable row level security;

-- Helper: get current user's house_id
create or replace function public.my_house_id()
returns uuid language sql stable security definer as $$
  select house_id from public.house_members where user_id = auth.uid()
$$;

-- Profiles: users can read all profiles in their house; update only their own
create policy "profiles: read housemates"
  on public.profiles for select
  using (
    id = auth.uid() or
    id in (
      select user_id from public.house_members
      where house_id = public.my_house_id()
    )
  );

create policy "profiles: insert own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid());

-- Houses: members can read their house; any authed user can insert
create policy "houses: read own"
  on public.houses for select
  using (id = public.my_house_id());

create policy "houses: insert"
  on public.houses for insert
  with check (auth.uid() is not null);

-- House members: read all members of own house; insert only self; delete only self
create policy "house_members: read housemates"
  on public.house_members for select
  using (house_id = public.my_house_id() or user_id = auth.uid());

create policy "house_members: join"
  on public.house_members for insert
  with check (user_id = auth.uid());

create policy "house_members: leave"
  on public.house_members for delete
  using (user_id = auth.uid());

-- Chores: full CRUD for house members
create policy "chores: house members"
  on public.chores for all
  using (house_id = public.my_house_id())
  with check (house_id = public.my_house_id());

-- Completions: house members can read; users can only insert/delete their own
create policy "completions: read"
  on public.chore_completions for select
  using (
    chore_id in (
      select id from public.chores where house_id = public.my_house_id()
    )
  );

create policy "completions: insert own"
  on public.chore_completions for insert
  with check (completed_by = auth.uid());

create policy "completions: delete own"
  on public.chore_completions for delete
  using (completed_by = auth.uid());
