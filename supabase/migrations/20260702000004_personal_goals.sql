-- Personal goals: per-user goals that are private (only visible to the owner).
-- Active days = distinct days this month where the user completed at least one chore
-- assigned to their house.

create table public.personal_goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  house_id      uuid not null references public.houses(id) on delete cascade,
  reward_text   text not null,
  target_days   int  not null default 20,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint personal_goals_user_house_unique unique (user_id, house_id)
);

alter table public.personal_goals enable row level security;

-- Users can only read and write their own rows
create policy "personal_goals_owner_all"
  on public.personal_goals for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Add to Realtime publication so the hook receives update events
do $$
declare v_exists boolean;
begin
  select exists(
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_goals'
  ) into v_exists;
  if not v_exists then
    alter publication supabase_realtime add table public.personal_goals;
  end if;
end;
$$;

-- RPC: returns personal momentum for the caller (current month by default).
-- Uses SECURITY INVOKER so auth.uid() is the client's identity and RLS applies normally.
create or replace function public.get_personal_momentum(
  p_house_id uuid,
  p_month    date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caller    uuid := auth.uid();
  v_month     date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_active    int;
  v_goal_text text;
  v_goal_days int;
  v_has_goal  boolean;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  -- Count distinct days the caller completed at least one chore in this house
  select count(distinct cc.for_date)::int into v_active
  from chore_completions cc
  join chores c on c.id = cc.chore_id
  where cc.completed_by = v_caller
    and c.house_id = p_house_id
    and cc.for_date >= v_month
    and cc.for_date < (v_month + interval '1 month')::date;

  -- Load personal goal settings (null if not set yet)
  select reward_text, target_days
  into   v_goal_text, v_goal_days
  from   personal_goals
  where  user_id = v_caller and house_id = p_house_id;

  v_has_goal := found;

  return jsonb_build_object(
    'active_days', coalesce(v_active, 0),
    'target_days', coalesce(v_goal_days, 20),
    'reward_text', v_goal_text,
    'has_goal',    v_has_goal
  );
end;
$$;
