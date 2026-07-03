-- Fix undo_chore_completion: capture auth.uid() once at the start.
-- Calling auth.uid() multiple times in a SECURITY DEFINER function is unreliable
-- in some Supabase setups — the value can differ or return NULL on later calls.
-- Capturing it early also allows an explicit null-check so we fail loudly
-- instead of silently deleting 0 rows.

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
  v_caller      uuid;
  v_owner       uuid;
  v_ledger      record;
  v_ledger_found boolean;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the row atomically while reading ownership.
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

  select points, house_id into v_ledger
  from public.score_ledger
  where chore_id = p_chore_id
    and for_date = p_for_date
    and user_id = v_caller
    and event_type = 'chore_completion'
  order by created_at desc
  limit 1;

  v_ledger_found := found;

  -- Ownership already verified above; delete by primary key only.
  delete from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date;

  if v_ledger_found then
    insert into public.score_ledger (user_id, house_id, event_type, points, chore_id, for_date)
    values (v_caller, v_ledger.house_id, 'chore_completion_reversal', -v_ledger.points, p_chore_id, p_for_date);
  end if;
end;
$$;
