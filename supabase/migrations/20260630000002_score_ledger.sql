-- supabase/migrations/20260630000002_score_ledger.sql

set search_path to public, extensions;

-- ─── score_ledger ────────────────────────────────────────────────────────────
create table if not exists public.score_ledger (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  house_id    uuid not null references public.houses(id) on delete cascade,
  event_type  text not null check (event_type in (
                'chore_completion',
                'chore_completion_reversal',
                'streak_bonus'
              )),
  points      integer not null,
  chore_id    uuid references public.chores(id) on delete set null,
  for_date    date not null,
  created_at  timestamptz not null default now()
);

create index score_ledger_user_date_idx on public.score_ledger (user_id, for_date);
create index score_ledger_house_idx     on public.score_ledger (house_id);

alter table public.score_ledger enable row level security;

create policy "house members read score_ledger"
  on public.score_ledger for select
  using (house_id in (
    select house_id from public.house_members where user_id = auth.uid()
  ));

-- Prevent completions on archived chores (restrictive = AND with other policies)
create policy "no completions on archived chores"
  on public.chore_completions
  as restrictive
  for insert
  with check (
    (select archived_at from public.chores where id = chore_id) is null
  );

-- ─── award_completion_points trigger ─────────────────────────────────────────
create or replace function public.award_completion_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chore   record;
  v_points  integer;
begin
  select due_date, house_id, archived_at
  into v_chore
  from public.chores
  where id = new.chore_id;

  if not found then
    return new;
  end if;

  -- Belt-and-suspenders: skip if chore was archived on or before the completion date
  if v_chore.archived_at is not null
     and new.for_date >= v_chore.archived_at::date then
    return new;
  end if;

  -- Overdue bonus only for one-time chores (due_date set)
  if v_chore.due_date is not null and new.for_date > v_chore.due_date then
    v_points := 15;
  else
    v_points := 10;
  end if;

  insert into public.score_ledger (user_id, house_id, event_type, points, chore_id, for_date)
  values (new.completed_by, v_chore.house_id, 'chore_completion', v_points, new.chore_id, new.for_date);

  return new;
end;
$$;

create trigger trg_award_completion_points
  after insert on public.chore_completions
  for each row execute function public.award_completion_points();

-- ─── undo_chore_completion RPC ───────────────────────────────────────────────
create or replace function public.undo_chore_completion(
  p_chore_id uuid,
  p_for_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion  record;
  v_owner       uuid;
  v_ledger      record;
begin
  select completed_by into v_owner
  from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date;

  if not found then
    return;
  end if;

  if v_owner <> auth.uid() then
    raise exception 'completion belongs to another user';
  end if;

  select * into v_completion
  from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date
    and completed_by = auth.uid()
  for update;

  if not found then
    return;
  end if;

  select points, house_id into v_ledger
  from public.score_ledger
  where chore_id = p_chore_id
    and for_date = p_for_date
    and user_id = auth.uid()
    and event_type = 'chore_completion'
  order by created_at desc
  limit 1;

  delete from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date
    and completed_by = auth.uid();

  if found then
    insert into public.score_ledger (user_id, house_id, event_type, points, chore_id, for_date)
    values (auth.uid(), v_ledger.house_id, 'chore_completion_reversal', -v_ledger.points, p_chore_id, p_for_date);
  end if;
end;
$$;
