alter table public.research_runs add column if not exists deadline_at timestamptz;
alter table public.research_runs add column if not exists error text;
update public.research_runs set deadline_at = created_at + interval '5 minutes' where deadline_at is null;
alter table public.research_runs alter column deadline_at set not null;
