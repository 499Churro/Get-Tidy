-- Fix personal active_days counting: previously counted any chore the user
-- completed in the house (too permissive — runs ahead of the house goal).
-- Now counts only distinct days where the user completed at least one chore
-- that was assigned specifically to them, aligning the personal and house
-- metrics to the same concept ("did you do your job today?").

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

  -- Count distinct days where the caller completed at least one chore
  -- that was assigned to them specifically.
  select count(distinct cc.for_date)::int into v_active
  from chore_completions cc
  join chores c on c.id = cc.chore_id
  where cc.completed_by = v_caller
    and c.house_id     = p_house_id
    and c.assigned_to  = v_caller
    and cc.for_date   >= v_month
    and cc.for_date    < (v_month + interval '1 month')::date;

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
