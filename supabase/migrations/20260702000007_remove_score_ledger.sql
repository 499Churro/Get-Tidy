-- Remove the points system entirely. Points were stored in score_ledger but
-- never drove meaningful product behaviour — the active-days counter handles
-- all progress tracking. Dropping the table, trigger, and ledger references
-- from undo_chore_completion.

-- Drop the per-completion trigger first, then the function it calls.
drop trigger if exists trg_award_completion_points on public.chore_completions;
drop function if exists public.award_completion_points();

-- Rewrite undo_chore_completion without score_ledger references.
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
  v_caller uuid;
  v_owner  uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select completed_by into v_owner
  from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date
  for update;

  if not found then
    return;
  end if;

  if v_owner <> v_caller then
    raise exception 'completion belongs to another user';
  end if;

  delete from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date;
end;
$$;

-- Drop the table last (trigger is gone so no FK issues).
drop table if exists public.score_ledger;
