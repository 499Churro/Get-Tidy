-- Add house_monthly_goals to the Realtime publication so the useMonthlyGoal
-- subscription fires on all members' devices when any member updates the goal.
do $$
declare v_exists boolean;
begin
  select exists(
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'house_monthly_goals'
  ) into v_exists;
  if not v_exists then
    alter publication supabase_realtime add table public.house_monthly_goals;
  end if;
end;
$$;
