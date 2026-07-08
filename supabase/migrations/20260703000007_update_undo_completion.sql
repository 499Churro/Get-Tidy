-- supabase/migrations/20260703000007_update_undo_completion.sql
--
-- Adds point reversal to undo_chore_completion.
-- The deletion of chore_completions in this function is intentional (user action).
-- We insert a chore_completion_reversal row into point_ledger here, not via
-- an AFTER DELETE trigger, so that cascade deletes from archiving a chore
-- do NOT corrupt ledger history.

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
  v_caller   uuid;
  v_owner    uuid;
  v_house_id uuid;
  v_points   integer;
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
    return;  -- already undone, idempotent
  end if;

  if v_owner <> v_caller then
    raise exception 'completion belongs to another user';
  end if;

  -- Look up point value and house for the reversal entry.
  select house_id, point_value into v_house_id, v_points
  from public.chores where id = p_chore_id;

  delete from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date;

  -- Insert reversal only if point_ledger exists (Phase B deployed) and chore has a point_value.
  if v_points is not null and exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'point_ledger'
  ) then
    insert into public.point_ledger (house_id, user_id, amount, reason, chore_id)
    values (v_house_id, v_caller, -v_points, 'chore_completion_reversal', p_chore_id);
  end if;
end;
$$;
