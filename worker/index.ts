import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { PostgresResearchJobQueue, classifyFailure, defaultQueueConfig, type ResearchJob, type ResearchJobQueue } from "@/lib/research/queue";
import { createResearchGraph } from "@/lib/research/graph";
import { markRunNeedsInput, recordExecutionEvent } from "@/lib/research/postgres-persistence";
import { query } from "@/lib/db";

type ResearchGraph = Awaited<ReturnType<typeof createResearchGraph>>;
type JobContext = { job: ResearchJob; graph: ResearchGraph; signal: AbortSignal };
type Handler = (context: JobContext) => Promise<unknown>;

const payloadSchemas = {
  "research.start": z.object({ runId: z.string().uuid() }),
  "research.resume": z.object({ runId: z.string().uuid(), message: z.string().min(1).max(4000) }),
} satisfies Record<ResearchJob["kind"], z.ZodType>;

async function loadRun(job: ResearchJob) {
  const result = await query<{ query: string }>("select query from public.research_runs where id=$1 and user_id=$2", [job.runId, job.userId]);
  if (!result.rows[0]) throw Object.assign(new Error("Research run no longer exists"), { retryable: false, code: "run_missing" });
  return result.rows[0];
}

const handlers = {
  "research.start": async ({ job, graph, signal }) => {
    const payload = payloadSchemas["research.start"].safeParse(job.payload);
    if (!payload.success || payload.data.runId !== job.runId) throw Object.assign(new Error("Invalid job payload"), { retryable: false, code: "invalid_payload" });
    const run = await loadRun(job);
    const config = { configurable: { thread_id: job.runId }, signal, maxConcurrency: 4, durability: "sync" } as never;
    return usesCheckpointResume(job) ? graph.invoke(null, config) : graph.invoke({ runId: job.runId, userId: job.userId, query: run.query, history: [] }, config);
  },
  "research.resume": async ({ job, graph, signal }) => {
    const payload = payloadSchemas["research.resume"].safeParse(job.payload);
    if (!payload.success || payload.data.runId !== job.runId) throw Object.assign(new Error("Invalid job payload"), { retryable: false, code: "invalid_payload" });
    await loadRun(job);
    const config = { configurable: { thread_id: job.runId }, signal, maxConcurrency: 4, durability: "sync" } as never;
    return usesCheckpointResume(job) ? graph.invoke(null, config) : graph.invoke(new Command({ resume: payload.data.message }), config);
  },
} satisfies Record<ResearchJob["kind"], Handler>;

export const registeredJobKinds = Object.freeze(Object.keys(handlers) as ResearchJob["kind"][]);
export function usesCheckpointResume(job: Pick<ResearchJob, "attempts" | "replayedFromJobId">) {
  return job.attempts > 1 || Boolean(job.replayedFromJobId);
}

export type WorkerOptions = {
  once?: boolean;
  queue?: ResearchJobQueue;
  stopSignal?: AbortSignal;
  graph?: ResearchGraph;
  concurrency?: number;
};

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

export async function processJob(job: ResearchJob, queue: ResearchJobQueue, graph: ResearchGraph, workerSignal: AbortSignal) {
  if (!job.runId) {
    await queue.fail(job, { retryable: false, code: "run_missing", message: "Research job has no run" });
    return false;
  }
  const controller = new AbortController();
  const stopJob = () => controller.abort(workerSignal.reason ?? new Error("Worker shutting down"));
  workerSignal.addEventListener("abort", stopJob, { once: true });
  const remaining = job.deadlineAt ? Date.parse(job.deadlineAt) - Date.now() : 5 * 60_000;
  const deadlineTimer = setTimeout(() => controller.abort(Object.assign(new Error("Research execution deadline expired"), { retryable: false, code: "deadline_expired" })), Math.max(0, remaining));
  const heartbeat = setInterval(() => {
    void queue.heartbeat(job).then(renewed => {
      if (!renewed) controller.abort(Object.assign(new Error("Research job was cancelled, timed out, or lost its lease"), { code: "lease_lost" }));
    }).catch(() => controller.abort(Object.assign(new Error("Research job heartbeat failed"), { code: "heartbeat_failed" })));
  }, getRuntimeConfig().WORKER_HEARTBEAT_MS);
  try {
    const result = await handlers[job.kind]({ job, graph, signal: controller.signal });
    const pending = (result as { __interrupt__?: unknown })?.__interrupt__;
    if (pending) {
      const first = Array.isArray(pending) ? pending[0] as { id?: string; value?: { questions?: string[] } } : undefined;
      const questions = first?.value?.questions ?? ["Please provide the missing details for this research request."];
      const interruptId = String(first?.id ?? crypto.randomUUID());
      await markRunNeedsInput(job.runId, job.userId, interruptId, questions);
      await recordExecutionEvent(job.runId, job.userId, "run.needs_input", { questionCount: questions.length }, `needs_input:${interruptId}`);
    }
    return await queue.complete(job);
  } catch (error) {
    if (workerSignal.aborted) return false;
    const failure = classifyFailure(controller.signal.aborted ? controller.signal.reason ?? error : error);
    await recordExecutionEvent(job.runId, job.userId, "worker.failed", { jobId: job.id, attempt: job.attempts, errorCode: failure.code }, `worker.failed:${job.id}:${job.attempts}`);
    return (await queue.fail(job, failure)) !== null;
  } finally {
    clearTimeout(deadlineTimer);
    clearInterval(heartbeat);
    workerSignal.removeEventListener("abort", stopJob);
  }
}

export async function runWorker(options: WorkerOptions = {}) {
  const runtime = getRuntimeConfig();
  if (!runtime.DATABASE_URL) throw new Error("DATABASE_URL is required for the research worker");
  const concurrency = options.concurrency ?? runtime.WORKER_CONCURRENCY;
  if (runtime.DATABASE_POOL_MAX < concurrency + 1) throw new Error("DATABASE_POOL_MAX must be at least WORKER_CONCURRENCY + 1");
  const queue = options.queue ?? new PostgresResearchJobQueue(defaultQueueConfig());
  const checkpointer = options.graph ? null : PostgresSaver.fromConnString(runtime.DATABASE_URL, { schema: "langgraph" });
  if (checkpointer) await checkpointer.setup();
  const graph = options.graph ?? createResearchGraph(checkpointer!);
  const controller = new AbortController();
  options.stopSignal?.addEventListener("abort", () => controller.abort(options.stopSignal?.reason), { once: true });
  const active = new Set<Promise<void>>();
  let claimed = 0;
  try {
    while (!controller.signal.aborted) {
      while (active.size < concurrency && !controller.signal.aborted && (!options.once || claimed === 0)) {
        const job = await queue.claim();
        if (!job) break;
        claimed += 1;
        let task!: Promise<void>;
        task = processJob(job, queue, graph, controller.signal).then(() => undefined).finally(() => active.delete(task));
        active.add(task);
      }
      if (options.once && claimed > 0) { await Promise.allSettled(active); break; }
      if (active.size >= concurrency) await Promise.race(active);
      else if (active.size > 0) await Promise.race([Promise.race(active), delay(runtime.WORKER_POLL_INTERVAL_MS, controller.signal)]).catch(() => undefined);
      else await delay(runtime.WORKER_POLL_INTERVAL_MS, controller.signal).catch(() => undefined);
    }
  } finally {
    controller.abort(new Error("Worker shutting down"));
    await Promise.allSettled(active);
    await queue.requeueOwned();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const controller = new AbortController();
  const shutdown = () => controller.abort(new Error("Worker shutting down"));
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  runWorker({ stopSignal: controller.signal }).catch(error => { console.error(error); process.exitCode = 1; });
}
