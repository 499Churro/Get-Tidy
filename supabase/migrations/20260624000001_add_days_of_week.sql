-- Add days_of_week column to chores table
-- 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
alter table public.chores add column days_of_week integer[] null;
