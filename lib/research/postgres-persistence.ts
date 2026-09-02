import type { PoolClient } from "pg";
import type { ResearchPlan, ResearchReport, SpecialistResult, Source } from "@/lib/contracts";
import { query, withTransaction } from "@/lib/db";

export async function recordExecutionEvent(
  runId: string,
  userId: string,
  eventType: string,
  detail: Record<string, unknown>,
  eventKey = `${eventType}:${crypto.randomUUID()}`,
) {
  try {
    const run = await query<{ thread_id: string }>(
      "select thread_id from public.research_runs where id = $1 and user_id = $2",
      [runId, userId],
    );
    const threadId = run.rows[0]?.thread_id;
    if (!threadId) return;
    await query(
      "insert into public.execution_events (user_id,thread_id,run_id,event_key,event_type,detail) values ($1,$2,$3,$4,$5,$6) on conflict (run_id,event_key) where run_id is not null do nothing",
      [userId, threadId, runId, eventKey, eventType, JSON.stringify(detail)],
    );
  } catch (error) {
    console.error("Could not persist research activity", { runId, eventType, error });
  }
}

export async function markRunRunning(runId: string, userId: string, plan: ResearchPlan) {
  await query("update public.research_runs set status = 'running', plan = $3, started_at = coalesce(started_at, now()), updated_at = now() where id = $1 and user_id = $2 and status in ('queued','running')", [runId, userId, JSON.stringify(plan)]);
}

export async function markRunNeedsInput(runId: string, userId: string, interruptId: string, questions: string[]) {
  await query("update public.research_runs set status = 'needs_input', pending_input = $3, deadline_at = null, updated_at = now() where id = $1 and user_id = $2", [runId, userId, JSON.stringify({ interruptId, questions })]);
}

export async function markSpecialistProgress(runId: string, userId: string, specialist: { id: string; label: string }, status: string, detail?: string, error?: string) {
  await query("insert into public.specialist_results (user_id, run_id, specialist_id, label, status, detail, error, updated_at) values ($1,$2,$3,$4,$5,$6,$7,now()) on conflict (run_id,specialist_id) do update set label=excluded.label,status=excluded.status,detail=excluded.detail,error=excluded.error,updated_at=now()", [userId, runId, specialist.id, specialist.label, status, detail ?? null, error ?? null]);
}

export async function finishRun(runId: string, userId: string, status: "completed" | "partial" | "failed", report?: ResearchReport, error?: string) {
  await withTransaction(async (client: PoolClient) => {
    if (report) {
      await client.query("insert into public.research_reports (user_id, run_id, version, report, fresh_at) values ($1,$2,$3,$4,$5) on conflict (run_id,version) do update set report=excluded.report,fresh_at=excluded.fresh_at", [userId, runId, report.version, JSON.stringify(report), report.freshAt]);
      await persistSources(client, userId, runId, report.sources);
      await client.query("update public.specialist_results set result = result where run_id = $1 and user_id = $2", [runId, userId]);
    }
    await client.query("update public.research_runs set status=$3, error=$4, pending_input=null, finished_at=now(), updated_at=now() where id=$1 and user_id=$2 and status <> 'cancelled'", [runId, userId, status, error ?? null]);
  });
}

async function persistSources(client: PoolClient, userId: string, runId: string, sources: Source[]) {
  for (const source of sources) {
    await client.query("insert into public.normalized_sources (user_id,run_id,source_key,canonical_url,title,publisher,published_at,retrieved_at,excerpt,source_type) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (run_id,source_key) do update set title=excluded.title,excerpt=excluded.excerpt,retrieved_at=excluded.retrieved_at", [userId, runId, source.id, source.canonicalUrl, source.title, source.publisher, source.publishedAt, source.retrievedAt, source.excerpt, source.type]);
  }
}

export async function persistSpecialistResult(runId: string, userId: string, result: SpecialistResult, sources: Source[]) {
  await withTransaction(async client => {
    await client.query("insert into public.specialist_results (user_id,run_id,specialist_id,label,status,findings,result,updated_at) values ($1,$2,$3,$3,'completed',$4,$5,now()) on conflict (run_id,specialist_id) do update set status='completed',findings=excluded.findings,result=excluded.result,updated_at=now()", [userId, runId, result.specialist, JSON.stringify(result.findings), JSON.stringify(result)]);
    await persistSources(client, userId, runId, sources);
  });
}
