-- supabase/migrations/20260630000005_fix_undo_rpc.sql
-- Fix undo_chore_completion: use single FOR UPDATE query + track ledger FOUND separately

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
  v_owner       uuid;
  v_ledger      record;
  v_ledger_found boolean;
begin
  -- Single query: lock the row atomically while reading ownership.
  -- FOR UPDATE returns no row if completion is already gone — idempotent return.
  select completed_by into v_owner
  from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date
  for update;

  -- Idempotent: completion already gone (concurrent undo succeeded) — nothing to do
  if not found then
    return;
  end if;

  -- Ownership check: reject if completion belongs to another user
  if v_owner <> auth.uid() then
    raise exception 'completion belongs to another user';
  end if;

  -- Find original award entry to match reversal amount.
  -- Save FOUND state NOW before any other SQL command changes it.
  select points, house_id into v_ledger
  from public.score_ledger
  where chore_id = p_chore_id
    and for_date = p_for_date
    and user_id = auth.uid()
    and event_type = 'chore_completion'
  order by created_at desc
  limit 1;

  v_ledger_found := found;  -- capture before DELETE resets FOUND

  -- Delete the completion row (no AFTER DELETE trigger on chore_completions)
  delete from public.chore_completions
  where chore_id = p_chore_id
    and for_date = p_for_date
    and completed_by = auth.uid();

  -- Insert reversal only if an original award exists
  if v_ledger_found then
    insert into public.score_ledger (user_id, house_id, event_type, points, chore_id, for_date)
    values (auth.uid(), v_ledger.house_id, 'chore_completion_reversal', -v_ledger.points, p_chore_id, p_for_date);
  end if;
end;
$$;
