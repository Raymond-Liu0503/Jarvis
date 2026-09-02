import { query } from "@/lib/db";

type Filters = { status?: string; kind?: string; runId?: string; from?: string; to?: string; cursor?: string; limit?: number };
const allowedStatuses = new Set(["queued", "running", "retry_scheduled", "completed", "cancelled", "dead_lettered"]);
const allowedKinds = new Set(["research.start", "research.resume"]);

function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt?: string; id?: string };
    return value.createdAt && value.id ? value : null;
  } catch { return null; }
}

function encodeCursor(createdAt: unknown, id: unknown) {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString("base64url");
}

export async function listOperatorJobs(filters: Filters) {
  const limit = Math.max(1, Math.min(100, filters.limit ?? 25));
  const values: unknown[] = [];
  const conditions: string[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); conditions.push(sql.replace("?", `$${values.length}`)); };
  if (filters.status && allowedStatuses.has(filters.status)) add("j.status::text = ?", filters.status);
  if (filters.kind && allowedKinds.has(filters.kind)) add("j.kind::text = ?", filters.kind);
  if (filters.runId) add("j.run_id = ?::uuid", filters.runId);
  if (filters.from) add("j.created_at >= ?::timestamptz", filters.from);
  if (filters.to) add("j.created_at <= ?::timestamptz", filters.to);
  const cursor = decodeCursor(filters.cursor);
  if (cursor) { values.push(cursor.createdAt, cursor.id); conditions.push(`(j.created_at,j.id) < ($${values.length - 1}::timestamptz,$${values.length}::uuid)`); }
  values.push(limit + 1);
  const result = await query<Record<string, unknown>>(`select j.id,j.user_id,j.run_id,j.kind::text,j.status::text,j.attempts,j.max_attempts,j.available_at,j.lease_owner,j.lease_expires_at,j.deadline_at,j.error_code,j.last_error,j.replayed_from_job_id,j.created_at,j.updated_at,j.finished_at from public.research_jobs j ${conditions.length ? `where ${conditions.join(" and ")}` : ""} order by j.created_at desc,j.id desc limit $${values.length}`, values);
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit).map(row => ({
    id: row.id, userId: row.user_id, runId: row.run_id, kind: row.kind, status: row.status,
    attempts: row.attempts, maxAttempts: row.max_attempts, availableAt: row.available_at,
    leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at, deadlineAt: row.deadline_at,
    errorCode: row.error_code, errorMessage: row.last_error, replayedFromJobId: row.replayed_from_job_id,
    createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at,
  }));
  const health = await query<Record<string, unknown>>(`select count(*) filter(where status='queued')::int queued, count(*) filter(where status='retry_scheduled')::int retry_scheduled, count(*) filter(where status='running')::int running, extract(epoch from now()-min(created_at) filter(where status='queued'))::int oldest_queued_seconds, count(distinct lease_owner) filter(where status='running')::int active_workers, count(*) filter(where status='running' and lease_expires_at>now())::int active_leases, coalesce(round(100.0*count(*) filter(where status='dead_lettered' and finished_at>=now()-interval '24 hours')/nullif(count(*) filter(where finished_at>=now()-interval '24 hours'),0),1),0)::float failure_rate_24h from public.research_jobs`);
  const tail = result.rows[Math.min(limit, result.rows.length) - 1];
  return { jobs: rows, nextCursor: hasMore && tail ? encodeCursor(tail.created_at, tail.id) : null, health: health.rows[0] };
}

export async function getOperatorJob(jobId: string) {
  const job = await query<Record<string, unknown>>("select id,user_id,run_id,kind::text,status::text,attempts,max_attempts,available_at,lease_owner,lease_expires_at,deadline_at,error_code,last_error,replayed_from_job_id,created_at,updated_at,started_at,finished_at from public.research_jobs where id=$1", [jobId]);
  if (!job.rows[0]) return null;
  const attempts = await query<Record<string, unknown>>("select id,attempt_number,worker_id,started_at,finished_at,outcome,retry_at,error_code,error_message from public.research_job_attempts where job_id=$1 order by attempt_number", [jobId]);
  const runId = job.rows[0].run_id;
  const run = runId ? await query<Record<string, unknown>>("select id,user_id,thread_id,status,created_at,updated_at,started_at,finished_at,deadline_at from public.research_runs where id=$1", [runId]) : { rows: [] };
  const events = runId ? await query<Record<string, unknown>>("select id,event_type,created_at from public.execution_events where run_id=$1 order by created_at desc limit 200", [runId]) : { rows: [] };
  return { job: job.rows[0], attempts: attempts.rows, run: run.rows[0] ?? null, events: events.rows };
}

export async function replayOperatorJob(jobId: string, actorId: string) {
  const result = await query<Record<string, unknown>>("select job.* from public.operator_replay_research_job($1,$2) job", [jobId, actorId]);
  return result.rows[0];
}

export async function cancelOperatorRun(runId: string, actorId: string) {
  const run = await query<{ user_id: string }>("select user_id from public.research_runs where id=$1", [runId]);
  if (!run.rows[0]) return false;
  const result = await query<{ cancelled: boolean }>("select public.cancel_research_as($1,$2,$3) cancelled", [runId, run.rows[0].user_id, actorId]);
  return result.rows[0]?.cancelled === true;
}
