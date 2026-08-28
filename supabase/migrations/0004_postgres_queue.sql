alter table public.research_runs
  alter column plan drop not null,
  alter column deadline_at drop not null;

alter table public.research_runs
  add column if not exists pending_input jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

alter table public.specialist_results
  add column if not exists label text,
  add column if not exists detail text,
  add column if not exists result jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.normalized_sources add column if not exists source_key text;
update public.normalized_sources set source_key = id::text where source_key is null;
alter table public.normalized_sources alter column source_key set not null;
create unique index if not exists normalized_sources_run_key on public.normalized_sources(run_id, source_key);

alter table public.execution_events add column if not exists event_key text;
update public.execution_events set event_key = id::text where event_key is null;
alter table public.execution_events alter column event_key set not null;
create unique index if not exists execution_events_run_key on public.execution_events(run_id, event_key) where run_id is not null;

create type public.research_job_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.research_job_kind as enum ('research.start', 'research.resume', 'dashboard.refresh');

create table public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  run_id uuid references public.research_runs on delete cascade,
  kind research_job_kind not null,
  payload jsonb not null default '{}',
  status research_job_status not null default 'queued',
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  idempotency_key text not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(user_id, idempotency_key)
);

alter table public.research_jobs enable row level security;
create index research_jobs_claim on public.research_jobs(status, available_at, created_at);
create index research_jobs_run on public.research_jobs(run_id, created_at);

create or replace function public.claim_research_job(p_worker text, p_lease interval)
returns setof public.research_jobs
language plpgsql security definer set search_path = public
as $$
begin
  update public.research_jobs
  set status = 'failed', last_error = coalesce(last_error, 'Lease expired after maximum attempts'),
      finished_at = now(), updated_at = now()
  where status = 'running' and lease_expires_at < now() and attempts >= max_attempts;

  return query
  with candidate as (
    select id from public.research_jobs
    where attempts < max_attempts
      and ((status = 'queued' and available_at <= now())
        or (status = 'running' and lease_expires_at < now()))
    order by available_at asc, created_at asc, id asc
    for update skip locked limit 1
  )
  update public.research_jobs job
  set status = 'running', attempts = job.attempts + 1,
      lease_owner = p_worker, lease_token = gen_random_uuid(),
      lease_expires_at = now() + p_lease, started_at = coalesce(job.started_at, now()),
      updated_at = now()
  from candidate where job.id = candidate.id
  returning job.*;
end;
$$;

revoke all on function public.claim_research_job(text, interval) from public, anon, authenticated;
grant execute on function public.claim_research_job(text, interval) to service_role;

create or replace function public.submit_research(
  p_query text,
  p_idempotency_key text,
  p_thread_id uuid default null
)
returns table(thread_id uuid, run_id uuid, status public.run_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_thread_id uuid;
  v_run_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if length(trim(p_query)) < 3 or length(p_query) > 4000 then raise exception 'Invalid research query'; end if;
  if length(trim(p_idempotency_key)) < 8 then raise exception 'Invalid idempotency key'; end if;

  -- Serialize retries for the same user/key so an idempotent retry cannot
  -- create an extra thread or race the run insert.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key, 0));

  select r.id, r.thread_id into v_run_id, v_thread_id
  from public.research_runs r
  where r.user_id = v_user_id and r.idempotency_key = p_idempotency_key;
  if v_run_id is not null then
    return query select v_thread_id, v_run_id, (select r.status from public.research_runs r where r.id = v_run_id);
    return;
  end if;

  if p_thread_id is null then
    insert into public.threads (user_id, title, skill_ids)
    values (v_user_id, left(trim(p_query), 80), '{}')
    returning id into v_thread_id;
  else
    select id into v_thread_id from public.threads where id = p_thread_id and user_id = v_user_id;
    if v_thread_id is null then raise exception 'Thread not found' using errcode = '42501'; end if;
  end if;

  insert into public.messages (user_id, thread_id, role, content)
  values (v_user_id, v_thread_id, 'user', trim(p_query));
  insert into public.research_runs (user_id, thread_id, query, status, idempotency_key)
  values (v_user_id, v_thread_id, trim(p_query), 'queued', p_idempotency_key)
  returning id into v_run_id;
  insert into public.research_jobs (user_id, run_id, kind, payload, idempotency_key)
  values (v_user_id, v_run_id, 'research.start', jsonb_build_object('runId', v_run_id), 'research.start:' || v_run_id);

  return query select v_thread_id, v_run_id, (select r.status from public.research_runs r where r.id = v_run_id);
end;
$$;

revoke all on function public.submit_research(text, text, uuid) from public, anon;
grant execute on function public.submit_research(text, text, uuid) to authenticated;

create or replace function public.resume_research(
  p_run_id uuid,
  p_message text
)
returns table(thread_id uuid, run_id uuid, status public.run_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_thread_id uuid;
  v_interrupt_id text;
  v_key text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select r.thread_id, r.pending_input->>'interruptId'
    into v_thread_id, v_interrupt_id
    from public.research_runs r
    where r.id = p_run_id and r.user_id = v_user_id and r.status = 'needs_input'
    for update;
  if v_thread_id is null or v_interrupt_id is null then raise exception 'Run is not awaiting input' using errcode = '42501'; end if;
  if length(trim(p_message)) < 1 or length(p_message) > 4000 then raise exception 'Invalid resume message'; end if;
  v_key := 'research.resume:' || p_run_id || ':' || v_interrupt_id;
  insert into public.messages (user_id, thread_id, role, content)
    values (v_user_id, v_thread_id, 'user', trim(p_message));
  update public.research_runs set status = 'queued', pending_input = null, updated_at = now()
    where id = p_run_id and user_id = v_user_id;
  insert into public.research_jobs (user_id, run_id, kind, payload, idempotency_key)
    values (v_user_id, p_run_id, 'research.resume', jsonb_build_object('runId', p_run_id, 'message', trim(p_message)), v_key)
    on conflict (user_id, idempotency_key) do nothing;
  return query select v_thread_id, p_run_id, 'queued'::public.run_status;
end;
$$;

revoke all on function public.resume_research(uuid, text) from public, anon;
grant execute on function public.resume_research(uuid, text) to authenticated;

create or replace function public.cancel_research(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count int;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.research_runs set status = 'cancelled', updated_at = now()
    where id = p_run_id and user_id = v_user_id and status not in ('completed','partial','failed','cancelled');
  get diagnostics v_count = row_count;
  if v_count = 1 then
    update public.research_jobs set status = 'cancelled', lease_owner = null, lease_token = null,
      lease_expires_at = null, finished_at = now(), updated_at = now()
      where run_id = p_run_id and user_id = v_user_id and status in ('queued','running');
  end if;
  return v_count = 1;
end;
$$;

revoke all on function public.cancel_research(uuid) from public, anon;
grant execute on function public.cancel_research(uuid) to authenticated;
