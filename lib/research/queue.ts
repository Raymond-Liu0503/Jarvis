import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";

export type JobKind = "research.start" | "research.resume" | "dashboard.refresh";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ResearchJob = {
  id: string; userId: string; runId: string | null; kind: JobKind;
  payload: Record<string, unknown>; status: JobStatus; attempts: number; maxAttempts: number;
  availableAt: string; leaseOwner: string | null; leaseToken: string | null;
  leaseExpiresAt: string | null; idempotencyKey: string; lastError: string | null;
};
export type QueueConfig = { workerId: string; leaseMs: number; maxAttempts: number };

function mapJob(row: Record<string, unknown>): ResearchJob {
  return {
    id: String(row.id), userId: String(row.user_id), runId: row.run_id ? String(row.run_id) : null,
    kind: row.kind as JobKind, payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as JobStatus, attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
    availableAt: String(row.available_at), leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
    idempotencyKey: String(row.idempotency_key), lastError: row.last_error ? String(row.last_error) : null,
  };
}

export interface ResearchJobQueue {
  enqueue(input: { userId: string; runId?: string; kind: JobKind; payload?: Record<string, unknown>; idempotencyKey: string; maxAttempts?: number }): Promise<ResearchJob>;
  claim(): Promise<ResearchJob | null>;
  heartbeat(job: ResearchJob): Promise<boolean>;
  complete(job: ResearchJob): Promise<boolean>;
  fail(job: ResearchJob, error: string, retryAt?: Date): Promise<boolean>;
  cancelRun(runId: string, userId: string): Promise<boolean>;
}

export class PostgresResearchJobQueue implements ResearchJobQueue {
  constructor(private readonly config: QueueConfig) {}

  async enqueue(input: Parameters<ResearchJobQueue["enqueue"]>[0]) {
    const result = await query<Record<string, unknown>>(
      "insert into public.research_jobs (user_id, run_id, kind, payload, idempotency_key, max_attempts) values ($1, $2, $3, $4, $5, $6) on conflict (user_id, idempotency_key) do update set updated_at = now() returning *",
      [input.userId, input.runId ?? null, input.kind, JSON.stringify(input.payload ?? {}), input.idempotencyKey, input.maxAttempts ?? this.config.maxAttempts],
    );
    return mapJob(result.rows[0]);
  }

  async claim() {
    const result = await query<Record<string, unknown>>("select * from public.claim_research_job($1, $2::interval)", [this.config.workerId, this.config.leaseMs + " milliseconds"]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  private async fenced(sql: string, values: unknown[]) {
    const result = await query(sql, values);
    return result.rowCount === 1;
  }

  heartbeat(job: ResearchJob) {
    return this.fenced("update public.research_jobs set lease_expires_at = now() + $3::interval, updated_at = now() where id = $1 and status = 'running' and lease_owner = $2 and lease_token = $4::uuid", [job.id, this.config.workerId, this.config.leaseMs + " milliseconds", job.leaseToken]);
  }

  complete(job: ResearchJob) {
    return this.fenced("update public.research_jobs set status = 'completed', lease_owner = null, lease_token = null, lease_expires_at = null, finished_at = now(), updated_at = now() where id = $1 and status = 'running' and lease_owner = $2 and lease_token = $3::uuid", [job.id, this.config.workerId, job.leaseToken]);
  }

  async fail(job: ResearchJob, error: string, retryAt = new Date(Date.now() + 1_000)) {
    return this.fenced("update public.research_jobs set status = case when attempts >= max_attempts then 'failed' else 'queued' end, available_at = $4, last_error = $5, lease_owner = null, lease_token = null, lease_expires_at = null, finished_at = case when attempts >= max_attempts then now() else null end, updated_at = now() where id = $1 and status = 'running' and lease_owner = $2 and lease_token = $3::uuid", [job.id, this.config.workerId, job.leaseToken, retryAt, error]);
  }

  async cancelRun(runId: string, userId: string) {
    return withTransaction(async (client: PoolClient) => {
      const run = await client.query("update public.research_runs set status = 'cancelled', updated_at = now() where id = $1 and user_id = $2 and status not in ('completed','partial','failed','cancelled') returning id", [runId, userId]);
      if (run.rowCount !== 1) return false;
      await client.query("update public.research_jobs set status = 'cancelled', lease_owner = null, lease_token = null, lease_expires_at = null, finished_at = now(), updated_at = now() where run_id = $1 and user_id = $2 and status in ('queued','running')", [runId, userId]);
      return true;
    });
  }
}

export function defaultQueueConfig(): QueueConfig {
  return { workerId: process.env.WORKER_ID ?? "jarvis-worker", leaseMs: Number(process.env.WORKER_LEASE_MS ?? 45_000), maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 3) };
}
