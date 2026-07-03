-- Enable Supabase Realtime for the tables the app subscribes to.
-- Without this, postgres_changes subscriptions silently receive no events.
do $$
declare
  v_exists boolean;
begin
  select exists(
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chores'
  ) into v_exists;
  if not v_exists then
    alter publication supabase_realtime add table public.chores;
  end if;

  select exists(
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chore_completions'
  ) into v_exists;
  if not v_exists then
    alter publication supabase_realtime add table public.chore_completions;
  end if;
end;
$$;
