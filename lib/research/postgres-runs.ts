import type { ResearchPlan, ResearchReport, RunStatus, SpecialistProgressState } from "@/lib/contracts";
import { query } from "@/lib/db";

type Row = Record<string, unknown>;
export type ResearchActivity = { id: string; type: string; message: string; createdAt: string };
type SpecialistProgress = { id: string; label: string; state: SpecialistProgressState; detail?: string; updatedAt: string; error?: string };
type PendingInput = { interruptId: string; questions: string[] };
export type PostgresRunRecord = { id: string; threadId: string; skillIds: string[]; query: string; plan: ResearchPlan | null; status: RunStatus; createdAt: string; updatedAt: string; deadlineAt: string | null; specialists: SpecialistProgress[]; report?: ResearchReport; error?: string; pendingInput?: PendingInput | null; activity: ResearchActivity[] };

function activityMessage(type: string, detail: Record<string, unknown>) {
  const label = typeof detail.label === "string" ? detail.label : "A specialist";
  const text = typeof detail.detail === "string" ? detail.detail : undefined;
  const messages: Record<string, string> = {
    "routing.started": "Selecting the right research skills",
    "routing.completed": "Research skills selected",
    "plan.completed": `Research plan created for ${Number(detail.specialistCount ?? 0)} specialists`,
    "research.started": "Specialists started working in parallel",
    "specialist.planning": `${label} is planning its research approach`,
    "specialist.searching": text ? `${label}: ${text}` : `${label} is searching for evidence`,
    "specialist.analyzing": `${label} is evaluating the collected evidence`,
    "specialist.completed": `${label} completed with ${Number(detail.findingCount ?? 0)} verified findings`,
    "specialist.failed": `${label} could not complete its research`,
    "synthesis.started": `Synthesizing ${Number(detail.sourceCount ?? 0)} sources into the report`,
    "run.completed": "Research report completed",
    "run.needs_input": "Research paused while waiting for your clarification",
    "worker.failed": "The research worker encountered an execution error",
  };
  return messages[type] ?? type.replaceAll(".", " ");
}

export async function getPostgresRun(userId: string, runId: string): Promise<PostgresRunRecord | undefined> {
  const runResult = await query<Row>("select * from public.research_runs where id = $1 and user_id = $2", [runId, userId]);
  const row = runResult.rows[0];
  if (!row) return undefined;
  const specialistResult = await query<Row>("select * from public.specialist_results where run_id = $1 and user_id = $2 order by specialist_id", [runId, userId]);
  const reportResult = await query<Row>("select report from public.research_reports where run_id = $1 and user_id = $2 order by version desc limit 1", [runId, userId]);
  const eventResult = await query<Row>("select id,event_type,detail,created_at from public.execution_events where run_id = $1 and user_id = $2 order by created_at asc limit 100", [runId, userId]);
  const specialists: SpecialistProgress[] = specialistResult.rows.map(item => ({
    id: String(item.specialist_id), label: String(item.label ?? item.specialist_id),
    state: item.status as SpecialistProgress["state"], detail: item.detail ? String(item.detail) : undefined,
    error: item.error ? String(item.error) : undefined, updatedAt: String(item.updated_at),
  }));
  const report = reportResult.rows[0]?.report as ResearchReport | null | undefined;
  const activity = eventResult.rows.map(item => {
    const detail = (item.detail ?? {}) as Record<string, unknown>;
    return { id: String(item.id), type: String(item.event_type), message: activityMessage(String(item.event_type), detail), createdAt: String(item.created_at) };
  });
  return {
    id: String(row.id), threadId: String(row.thread_id), skillIds: (row.skill_ids ?? []) as string[],
    query: String(row.query), plan: (row.plan ?? null) as ResearchPlan | null, status: row.status as RunStatus,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    deadlineAt: row.deadline_at ? String(row.deadline_at) : null, specialists, report: report ?? undefined,
    error: row.error ? String(row.error) : undefined, pendingInput: (row.pending_input ?? null) as PendingInput | null, activity,
  };
}
