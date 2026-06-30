alter table public.chores
  add column if not exists archived_at timestamptz default null;

create index if not exists chores_archived_at_idx
  on public.chores (archived_at)
  where archived_at is not null;
