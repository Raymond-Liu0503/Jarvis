-- Production hardening for the PostgreSQL-backed LangGraph runtime.

alter table public.research_jobs
  add column if not exists deadline_at timestamptz,
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists replayed_from_job_id uuid references public.research_jobs(id),
  add column if not exists error_code text;

update public.research_jobs set status='cancelled', finished_at=now(), updated_at=now()
where kind::text='legacy.disabled' and status in ('queued','running');

-- Payloads are accepted only through controlled functions and never exposed by ops APIs.
create unique index research_jobs_one_active_per_run
  on public.research_jobs(run_id)
  where run_id is not null and status in ('queued', 'running', 'retry_scheduled');
create index research_jobs_ops on public.research_jobs(status, kind, created_at desc, id desc);
create index research_jobs_replay on public.research_jobs(replayed_from_job_id) where replayed_from_job_id is not null;

create table public.research_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.research_jobs(id) on delete cascade,
  attempt_number int not null check (attempt_number > 0),
  worker_id text not null,
  lease_token uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('completed', 'retry_scheduled', 'cancelled', 'dead_lettered', 'lease_expired', 'shutdown_requeued')),
  retry_at timestamptz,
  error_code text,
  error_message text check (error_message is null or octet_length(error_message) <= 2048),
  unique(job_id, attempt_number),
  unique(job_id, lease_token)
);
alter table public.research_job_attempts enable row level security;
create index research_job_attempts_job on public.research_job_attempts(job_id, attempt_number);

create table public.operator_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users on delete restrict,
  action text not null check (action in ('job.replay', 'run.cancel')),
  target_type text not null check (target_type in ('job', 'run')),
  target_id uuid not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.operator_actions enable row level security;
create index operator_actions_target on public.operator_actions(target_type, target_id, created_at);

create or replace function public.is_operator()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'operator' $$;
revoke all on function public.is_operator() from public, anon;
grant execute on function public.is_operator() to authenticated, service_role;

create policy "operators read jobs" on public.research_jobs for select to authenticated using (public.is_operator());
create policy "operators read attempts" on public.research_job_attempts for select to authenticated using (public.is_operator());
create policy "operators read actions" on public.operator_actions for select to authenticated using (public.is_operator());

create or replace function public.enqueue_research_job(
  p_user_id uuid, p_run_id uuid, p_kind public.research_job_kind, p_payload jsonb,
  p_idempotency_key text, p_max_attempts int default 3, p_replayed_from_job_id uuid default null
) returns public.research_jobs
language plpgsql security definer set search_path = public as $$
declare v_existing public.research_jobs; v_job public.research_jobs;
begin
  if p_kind::text = 'legacy.disabled' then raise exception 'Unsupported job kind' using errcode = '22023'; end if;
  if p_max_attempts < 1 then raise exception 'Invalid maximum attempts' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_idempotency_key, 0));
  select * into v_existing from public.research_jobs where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.kind <> p_kind or v_existing.run_id is distinct from p_run_id or v_existing.payload <> coalesce(p_payload, '{}') then
      raise exception 'Idempotency key was already used for a different request' using errcode = '23505';
    end if;
    return v_existing;
  end if;
  insert into public.research_jobs(user_id, run_id, kind, payload, idempotency_key, max_attempts, replayed_from_job_id)
    values(p_user_id, p_run_id, p_kind, coalesce(p_payload, '{}'), p_idempotency_key, p_max_attempts, p_replayed_from_job_id)
    returning * into v_job;
  return v_job;
end $$;
revoke all on function public.enqueue_research_job(uuid,uuid,public.research_job_kind,jsonb,text,int,uuid) from public, anon, authenticated;
grant execute on function public.enqueue_research_job(uuid,uuid,public.research_job_kind,jsonb,text,int,uuid) to service_role;

create or replace function public.claim_research_job(p_worker text, p_lease interval)
returns setof public.research_jobs language plpgsql security definer set search_path = public as $$
declare v_job public.research_jobs;
begin
  -- Recover expired ownership before claiming. Exhausted or expired work is terminal.
  with expired as (
    select * from public.research_jobs
    where status = 'running' and lease_expires_at < now() for update skip locked
  ), closed as (
    update public.research_job_attempts a set finished_at = now(), outcome = 'lease_expired',
      error_code = 'lease_expired', error_message = 'Worker lease expired'
    from expired e where a.job_id = e.id and a.lease_token = e.lease_token and a.finished_at is null
  )
  update public.research_jobs j set
    status = case when j.attempts >= j.max_attempts or (j.deadline_at is not null and j.deadline_at <= now())
      then 'dead_lettered'::public.research_job_status else 'retry_scheduled'::public.research_job_status end,
    available_at = now(), error_code = 'lease_expired', last_error = 'Worker lease expired',
    lease_owner = null, lease_token = null, lease_expires_at = null,
    finished_at = case when j.attempts >= j.max_attempts or (j.deadline_at is not null and j.deadline_at <= now()) then now() else null end,
    updated_at = now()
  where j.status = 'running' and j.lease_expires_at < now();

  update public.research_runs r set status='failed', error='Research execution lease expired after its retry budget',
    finished_at=now(), updated_at=now()
  where status not in ('completed','partial','failed','cancelled') and exists (
    select 1 from public.research_jobs j where j.run_id=r.id and j.status='dead_lettered' and j.error_code='lease_expired'
  );

  select * into v_job from public.research_jobs
  where attempts < max_attempts and cancellation_requested_at is null
    and status in ('queued', 'retry_scheduled') and available_at <= now()
  order by available_at, created_at, id for update skip locked limit 1;
  if not found then return; end if;

  update public.research_jobs set status = 'running', attempts = attempts + 1,
    lease_owner = p_worker, lease_token = gen_random_uuid(), lease_expires_at = now() + p_lease,
    deadline_at = now() + interval '5 minutes', started_at = coalesce(started_at, now()), updated_at = now()
  where id = v_job.id returning * into v_job;
  update public.research_runs set status = case when status = 'needs_input' then 'queued'::public.run_status else status end,
    deadline_at = v_job.deadline_at, updated_at = now()
  where id = v_job.run_id and status not in ('completed','partial','failed','cancelled');
  insert into public.research_job_attempts(job_id, attempt_number, worker_id, lease_token)
    values(v_job.id, v_job.attempts, p_worker, v_job.lease_token);
  return next v_job;
end $$;

create or replace function public.heartbeat_research_job(p_job_id uuid, p_worker text, p_token uuid, p_lease interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update public.research_jobs set lease_expires_at = least(now() + p_lease, deadline_at), updated_at = now()
  where id = p_job_id and status = 'running' and lease_owner = p_worker and lease_token = p_token
    and cancellation_requested_at is null and deadline_at > now();
  get diagnostics v_count = row_count; return v_count = 1;
end $$;

create or replace function public.complete_research_job(p_job_id uuid, p_worker text, p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update public.research_jobs set status='completed', lease_owner=null, lease_token=null,
    lease_expires_at=null, finished_at=now(), updated_at=now()
  where id=p_job_id and status='running' and lease_owner=p_worker and lease_token=p_token
    and cancellation_requested_at is null and deadline_at > now();
  get diagnostics v_count = row_count;
  if v_count = 1 then update public.research_job_attempts set finished_at=now(), outcome='completed'
    where job_id=p_job_id and lease_token=p_token and finished_at is null; end if;
  return v_count = 1;
end $$;

create or replace function public.fail_research_job(
  p_job_id uuid, p_worker text, p_token uuid, p_retryable boolean, p_error_code text, p_error_message text
) returns text language plpgsql security definer set search_path = public as $$
declare v_job public.research_jobs; v_retry_at timestamptz; v_terminal boolean; v_outcome text;
begin
  select * into v_job from public.research_jobs where id=p_job_id and status='running'
    and lease_owner=p_worker and lease_token=p_token for update;
  if not found then return null; end if;
  v_terminal := not p_retryable or v_job.attempts >= v_job.max_attempts or v_job.deadline_at <= now();
  v_retry_at := now() + make_interval(secs => least(60, power(2, greatest(0, v_job.attempts - 1))) * (1 + random() * .25));
  v_outcome := case when v_terminal then 'dead_lettered' else 'retry_scheduled' end;
  update public.research_job_attempts set finished_at=now(), outcome=v_outcome,
    retry_at=case when v_terminal then null else v_retry_at end, error_code=left(p_error_code,128), error_message=left(p_error_message,2048)
    where job_id=p_job_id and lease_token=p_token and finished_at is null;
  update public.research_jobs set status=v_outcome::public.research_job_status,
    available_at=case when v_terminal then available_at else v_retry_at end,
    lease_owner=null, lease_token=null, lease_expires_at=null, error_code=left(p_error_code,128),
    last_error=left(p_error_message,2048), finished_at=case when v_terminal then now() else null end, updated_at=now()
    where id=p_job_id;
  if v_terminal then update public.research_runs set status='failed', error=left(p_error_message,2048),
    finished_at=now(), updated_at=now() where id=v_job.run_id and status not in ('completed','partial','cancelled');
  else update public.research_runs set status='running', error=null, updated_at=now()
    where id=v_job.run_id and status not in ('completed','partial','failed','cancelled'); end if;
  return v_outcome;
end $$;

create or replace function public.cancel_research_as(p_run_id uuid, p_user_id uuid, p_actor uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update public.research_runs set status='cancelled', deadline_at=null, finished_at=now(), updated_at=now()
    where id=p_run_id and user_id=p_user_id and status not in ('completed','partial','failed','cancelled');
  get diagnostics v_count = row_count;
  if v_count = 1 then
    update public.research_jobs set status='cancelled', cancellation_requested_at=now(),
      lease_owner=null, lease_token=null, lease_expires_at=null, finished_at=now(), updated_at=now()
      where run_id=p_run_id and status in ('queued','running','retry_scheduled');
    update public.research_job_attempts a set finished_at=now(), outcome='cancelled'
      from public.research_jobs j where a.job_id=j.id and j.run_id=p_run_id and a.finished_at is null;
    if p_actor is not null then insert into public.operator_actions(actor_user_id,action,target_type,target_id)
      values(p_actor,'run.cancel','run',p_run_id); end if;
  end if;
  return v_count = 1;
end $$;

create or replace function public.cancel_research(p_run_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid();
begin if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
return public.cancel_research_as(p_run_id, v_user_id, null); end $$;

create or replace function public.requeue_worker_jobs(p_worker text)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update public.research_job_attempts a set finished_at=now(), outcome='shutdown_requeued'
    from public.research_jobs j where a.job_id=j.id and j.status='running' and j.lease_owner=p_worker
      and a.lease_token=j.lease_token and a.finished_at is null;
  update public.research_jobs set status='retry_scheduled', available_at=now(), lease_owner=null,
    lease_token=null, lease_expires_at=null, updated_at=now()
    where status='running' and lease_owner=p_worker;
  get diagnostics v_count = row_count; return v_count;
end $$;

create or replace function public.operator_replay_research_job(p_job_id uuid, p_actor uuid)
returns public.research_jobs language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid; v_run_id uuid; v_kind public.research_job_kind; v_payload jsonb;
  v_max_attempts int; v_status public.research_job_status; v_new public.research_jobs;
begin
  if not exists(select 1 from auth.users where id=p_actor and raw_app_meta_data->>'role'='operator') then
    raise exception 'Operator role required' using errcode='42501'; end if;
  select user_id,run_id,kind,payload,max_attempts,status into v_user_id,v_run_id,v_kind,v_payload,v_max_attempts,v_status
    from public.research_jobs where id=p_job_id for update;
  if not found or v_status <> 'dead_lettered' then raise exception 'Job is not eligible for replay' using errcode='23514'; end if;
  -- The partial unique index atomically rejects a replay if an active job exists.
  insert into public.research_jobs(user_id,run_id,kind,payload,idempotency_key,max_attempts,replayed_from_job_id)
    values(v_user_id,v_run_id,v_kind,v_payload,'replay:'||p_job_id||':'||gen_random_uuid(),v_max_attempts,p_job_id)
    returning * into v_new;
  update public.research_runs set status='queued',error=null,deadline_at=null,finished_at=null,updated_at=now()
    where id=v_run_id and status='failed';
  insert into public.operator_actions(actor_user_id,action,target_type,target_id,detail)
    values(p_actor,'job.replay','job',p_job_id,jsonb_build_object('replacementJobId',v_new.id));
  return v_new;
end $$;

-- Human input pauses the execution deadline. Claiming the resume creates a fresh one.
create or replace function public.pause_research_deadline(p_run_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int; begin update public.research_runs set deadline_at=null, updated_at=now()
where id=p_run_id and user_id=p_user_id and status='needs_input'; get diagnostics v_count=row_count; return v_count=1; end $$;

-- Tighten the existing submission functions to use the active-job invariant and fresh deadlines.
create or replace function public.resume_research(p_run_id uuid, p_message text)
returns table(thread_id uuid, run_id uuid, status public.run_status)
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid:=auth.uid(); v_thread_id uuid; v_interrupt_id text; v_key text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select r.thread_id,r.pending_input->>'interruptId' into v_thread_id,v_interrupt_id from public.research_runs r
    where r.id=p_run_id and r.user_id=v_user_id and r.status='needs_input' for update;
  if v_thread_id is null or v_interrupt_id is null then raise exception 'Run is not awaiting input' using errcode='42501'; end if;
  if length(trim(p_message))<1 or length(p_message)>4000 then raise exception 'Invalid resume message'; end if;
  v_key:='research.resume:'||p_run_id||':'||v_interrupt_id;
  insert into public.messages(user_id,thread_id,role,content) values(v_user_id,v_thread_id,'user',trim(p_message));
  update public.research_runs set status='queued',pending_input=null,deadline_at=null,updated_at=now() where id=p_run_id;
  perform public.enqueue_research_job(v_user_id,p_run_id,'research.resume',jsonb_build_object('runId',p_run_id,'message',trim(p_message)),v_key,3,null);
  return query select v_thread_id,p_run_id,'queued'::public.run_status;
end $$;

do $$ declare f text; begin foreach f in array array[
  'heartbeat_research_job(uuid,text,uuid,interval)','complete_research_job(uuid,text,uuid)',
  'fail_research_job(uuid,text,uuid,boolean,text,text)','cancel_research_as(uuid,uuid,uuid)',
  'requeue_worker_jobs(text)','operator_replay_research_job(uuid,uuid)','pause_research_deadline(uuid,uuid)'
] loop execute 'revoke all on function public.'||f||' from public, anon, authenticated'; execute 'grant execute on function public.'||f||' to service_role'; end loop; end $$;
