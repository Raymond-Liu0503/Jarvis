import { hostname } from "node:os";
import { query } from "@/lib/db";

export type JobKind = "research.start" | "research.resume";
export type JobStatus = "queued" | "running" | "retry_scheduled" | "completed" | "cancelled" | "dead_lettered";
export type ResearchJob = {
  id: string; userId: string; runId: string | null; kind: JobKind;
  payload: Record<string, unknown>; status: JobStatus; attempts: number; maxAttempts: number;
  availableAt: string; leaseOwner: string | null; leaseToken: string | null;
  leaseExpiresAt: string | null; deadlineAt: string | null; idempotencyKey: string;
  lastError: string | null; errorCode: string | null; replayedFromJobId: string | null;
};
export type QueueConfig = { workerId: string; leaseMs: number; maxAttempts: number };
export type Failure = { retryable: boolean; code: string; message: string };

const processIdentity = `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

export function sanitizeError(error: unknown): { code: string; message: string } {
  const candidate = error instanceof Error ? error : new Error("Worker execution failed");
  const code = String((candidate as Error & { code?: unknown }).code ?? candidate.name ?? "worker_error")
    .toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 128) || "worker_error";
  const redacted = candidate.message
    .replace(/((?:api[_-]?key|authorization|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ").trim();
  return { code, message: (redacted || "Worker execution failed").slice(0, 2048) };
}

const deterministicPatterns = [
  /invalid (?:job )?payload/i, /no longer exists/i, /not found/i, /deadline/i,
  /skill version changed/i, /specialist not found/i, /plan is missing/i,
  /planner did not produce/i, /at least 2 are required/i,
];

export function classifyFailure(error: unknown): Failure {
  const clean = sanitizeError(error);
  const explicit = error as { retryable?: unknown } | null;
  const retryable = typeof explicit?.retryable === "boolean" ? explicit.retryable : !deterministicPatterns.some(pattern => pattern.test(clean.message));
  return { ...clean, retryable };
}

export function retryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return Math.floor(base * (1 + Math.max(0, Math.min(1, random())) * 0.25));
}

function mapJob(row: Record<string, unknown>): ResearchJob {
  return {
    id: String(row.id), userId: String(row.user_id), runId: row.run_id ? String(row.run_id) : null,
    kind: row.kind as JobKind, payload: (row.payload ?? {}) as Record<string, unknown>, status: row.status as JobStatus,
    attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts), availableAt: String(row.available_at),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null, leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null, deadlineAt: row.deadline_at ? String(row.deadline_at) : null,
    idempotencyKey: String(row.idempotency_key), lastError: row.last_error ? String(row.last_error) : null,
    errorCode: row.error_code ? String(row.error_code) : null, replayedFromJobId: row.replayed_from_job_id ? String(row.replayed_from_job_id) : null,
  };
}

export interface ResearchJobQueue {
  readonly workerId: string;
  enqueue(input: { userId: string; runId?: string; kind: JobKind; payload?: Record<string, unknown>; idempotencyKey: string; maxAttempts?: number }): Promise<ResearchJob>;
  claim(): Promise<ResearchJob | null>;
  heartbeat(job: ResearchJob): Promise<boolean>;
  complete(job: ResearchJob): Promise<boolean>;
  fail(job: ResearchJob, failure: Failure): Promise<JobStatus | null>;
  requeueOwned(): Promise<number>;
}

export class IdempotencyConflictError extends Error {
  constructor(message = "Idempotency key was already used for a different request") { super(message); this.name = "IdempotencyConflictError"; }
}

export class PostgresResearchJobQueue implements ResearchJobQueue {
  readonly workerId: string;
  constructor(private readonly config: QueueConfig) { this.workerId = config.workerId; }
  async enqueue(input: Parameters<ResearchJobQueue["enqueue"]>[0]) {
    try {
      const result = await query<Record<string, unknown>>("select job.* from public.enqueue_research_job($1,$2,$3,$4,$5,$6,null) job", [input.userId, input.runId ?? null, input.kind, JSON.stringify(input.payload ?? {}), input.idempotencyKey, input.maxAttempts ?? this.config.maxAttempts]);
      return mapJob(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new IdempotencyConflictError();
      throw error;
    }
  }
  async claim() {
    const result = await query<Record<string, unknown>>("select * from public.claim_research_job($1,$2::interval)", [this.workerId, `${this.config.leaseMs} milliseconds`]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }
  async heartbeat(job: ResearchJob) {
    const result = await query<{ renewed: boolean }>("select public.heartbeat_research_job($1,$2,$3,$4::interval) renewed", [job.id, this.workerId, job.leaseToken, `${this.config.leaseMs} milliseconds`]);
    return result.rows[0]?.renewed === true;
  }
  async complete(job: ResearchJob) {
    const result = await query<{ completed: boolean }>("select public.complete_research_job($1,$2,$3) completed", [job.id, this.workerId, job.leaseToken]);
    return result.rows[0]?.completed === true;
  }
  async fail(job: ResearchJob, failure: Failure) {
    const result = await query<{ status: JobStatus | null }>("select public.fail_research_job($1,$2,$3,$4,$5,$6) status", [job.id, this.workerId, job.leaseToken, failure.retryable, failure.code, failure.message]);
    return result.rows[0]?.status ?? null;
  }
  async requeueOwned() {
    const result = await query<{ count: number }>("select public.requeue_worker_jobs($1) count", [this.workerId]);
    return Number(result.rows[0]?.count ?? 0);
  }
}

export function defaultQueueConfig(): QueueConfig {
  return { workerId: process.env.WORKER_ID?.trim() || processIdentity, leaseMs: Number(process.env.WORKER_LEASE_MS ?? 45_000), maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 3) };
}
