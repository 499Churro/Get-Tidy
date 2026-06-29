-- Tighten completion insert policy: verify chore belongs to user's house.
-- Previously only checked completed_by = auth.uid(), allowing a user who knows
-- a valid chore_id from another house to insert a completion for it.
drop policy if exists "completions: insert own" on public.chore_completions;

create policy "completions: insert own"
  on public.chore_completions for insert
  with check (
    completed_by = auth.uid()
    and chore_id in (
      select id from public.chores where house_id = public.my_house_id()
    )
  );
