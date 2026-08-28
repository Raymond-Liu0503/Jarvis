import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { PostgresResearchJobQueue, defaultQueueConfig, type ResearchJob } from "@/lib/research/queue";
import { createResearchGraph } from "@/lib/research/graph";
import { finishRun, markRunNeedsInput, recordExecutionEvent } from "@/lib/research/postgres-persistence";
import { query } from "@/lib/db";

export type WorkerOptions = { once?: boolean; queue?: PostgresResearchJobQueue; stopSignal?: AbortSignal };

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Worker shutting down")); }, { once: true });
  });
}

async function processJob(job: ResearchJob, queue: PostgresResearchJobQueue, graph: Awaited<ReturnType<typeof createResearchGraph>>, signal: AbortSignal) {
  if (!job.runId) return queue.complete(job);
  const heartbeat = setInterval(() => { void queue.heartbeat(job); }, getRuntimeConfig().WORKER_HEARTBEAT_MS);
  try {
    const config = { configurable: { thread_id: job.runId }, signal } as never;
    const runResult = await query<{ query: string }>("select query from public.research_runs where id = $1 and user_id = $2", [job.runId, job.userId]);
    const run = runResult.rows[0];
    if (!run) throw new Error("Research run no longer exists");
    const result = job.kind === "research.resume"
      ? await graph.invoke(new Command({ resume: String(job.payload.message ?? "") }), config)
      : await graph.invoke({ runId: job.runId, userId: job.userId, query: run.query, history: [] }, config);
    const pending = (result as { __interrupt__?: unknown }).__interrupt__;
    if (pending) {
      const value = Array.isArray(pending) ? (pending[0] as { value?: { questions?: string[] } })?.value : undefined;
      const questions = value?.questions ?? ["Please provide the missing details for this research request."];
      await markRunNeedsInput(job.runId, job.userId, Array.isArray(pending) ? String((pending[0] as { id?: string }).id) : crypto.randomUUID(), questions);
      await recordExecutionEvent(job.runId, job.userId, "run.needs_input", { questionCount: questions.length }, `needs_input:${Array.isArray(pending) ? String((pending[0] as { id?: string }).id) : job.id}`);
    }
    return await queue.complete(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker execution failed";
    if (job.runId) await recordExecutionEvent(job.runId, job.userId, "worker.failed", { jobId: job.id, attempt: job.attempts, error: message }, `worker.failed:${job.id}:${job.attempts}`);
    if (!signal.aborted && job.runId) await finishRun(job.runId, job.userId, "failed", undefined, message);
    if (signal.aborted) return false;
    const retryAt = new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempts - 1)));
    return queue.fail(job, message, retryAt);
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runWorker(options: WorkerOptions = {}) {
  const runtime = getRuntimeConfig();
  if (!runtime.DATABASE_URL) throw new Error("DATABASE_URL is required for the research worker");
  const queue = options.queue ?? new PostgresResearchJobQueue(defaultQueueConfig());
  const checkpointer = PostgresSaver.fromConnString(runtime.DATABASE_URL, { schema: "langgraph" });
  await checkpointer.setup();
  const graph = createResearchGraph(checkpointer);
  const controller = new AbortController();
  options.stopSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  while (!controller.signal.aborted) {
    const job = await queue.claim();
    if (job) {
      await processJob(job, queue, graph, controller.signal);
      if (options.once) break;
    } else {
      try { await delay(runtime.WORKER_POLL_INTERVAL_MS, controller.signal); } catch { break; }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
  runWorker({ stopSignal: controller.signal }).catch(error => { console.error(error); process.exitCode = 1; });
}
