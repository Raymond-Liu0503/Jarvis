create table public.web_research_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  cache_key text not null,
  schema_version text not null,
  request jsonb not null default '{}',
  results jsonb not null default '[]',
  candidate_count int not null default 0 check (candidate_count >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, cache_key)
);

alter table public.web_research_cache enable row level security;
create policy "owner access" on public.web_research_cache for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index web_research_cache_expiry on public.web_research_cache(user_id, expires_at desc);
