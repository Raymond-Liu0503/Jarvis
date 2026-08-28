import { Annotation, BaseCheckpointSaver, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { ResearchPlan, ResearchReport, SpecialistResult, Source } from "@/lib/contracts";
import { routeSkills, planResearch } from "@/lib/skills/routing";
import { getSkill } from "@/lib/skills/loader";
import { runSpecialist, synthesizeReport } from "@/lib/research/agents";
import { EvidenceStore } from "@/lib/research/evidence";
import { markRunRunning, markSpecialistProgress, persistSpecialistResult, finishRun, recordExecutionEvent } from "@/lib/research/postgres-persistence";

const ResearchState = Annotation.Root({
  runId: Annotation<string>, userId: Annotation<string>, query: Annotation<string>, history: Annotation<Array<{ role: string; content: string }>>({ value: (_, next) => next, default: () => [] }),
  skillIds: Annotation<string[]>({ value: (_, next) => next, default: () => [] }), plan: Annotation<ResearchPlan | null>({ value: (_, next) => next, default: () => null }), results: Annotation<SpecialistResult[]>({ value: (_, next) => next, default: () => [] }), sources: Annotation<Source[]>({ value: (_, next) => next, default: () => [] }), report: Annotation<ResearchReport | null>({ value: (_, next) => next, default: () => null }),
});

export type ResearchGraphState = typeof ResearchState.State;

async function route(state: ResearchGraphState) {
  await recordExecutionEvent(state.runId, state.userId, "routing.started", {}, "routing.started");
  const routed = await routeSkills(state.query, state.history);
  await recordExecutionEvent(state.runId, state.userId, "routing.completed", { skillIds: routed.selections.map(item => item.skillId) }, "routing.completed");
  return { skillIds: routed.selections.map(item => item.skillId) };
}

async function plan(state: ResearchGraphState) {
  let planned = await planResearch(state.skillIds, state.query, state.history);
  if (planned.questions?.length) {
    const answer = interrupt({ questions: planned.questions });
    planned = await planResearch(state.skillIds, state.query, [...state.history, { role: "user", content: String(answer) }]);
  }
  if (!planned.plan) throw new Error("Research planner did not produce a plan");
  await markRunRunning(state.runId, state.userId, planned.plan);
  await recordExecutionEvent(state.runId, state.userId, "plan.completed", { specialistCount: planned.plan.specialists.length }, "plan.completed");
  return { plan: planned.plan };
}

async function execute(state: ResearchGraphState) {
  if (!state.plan) throw new Error("Research plan is missing");
  await recordExecutionEvent(state.runId, state.userId, "research.started", { specialists: state.plan.specialists.map(item => item.label) }, "research.started");
  const settled = await Promise.allSettled(state.plan.specialists.map(async planned => {
    const definition = getSkill(planned.skillId).specialists.find(item => item.id === planned.id);
    if (!definition) throw new Error(`Specialist not found: ${planned.id}`);
    await markSpecialistProgress(state.runId, state.userId, planned, "planning", definition.mission);
    const evidence = new EvidenceStore(5);
    try {
      const result = await runSpecialist({ definition, query: state.query, evidence, onProgress: async (status, detail) => {
        await markSpecialistProgress(state.runId, state.userId, planned, status, detail);
        await recordExecutionEvent(state.runId, state.userId, `specialist.${status}`, { specialistId: planned.id, label: planned.label, detail }, `${planned.id}:${status}`);
      } });
      await persistSpecialistResult(state.runId, state.userId, result, evidence.all());
      await recordExecutionEvent(state.runId, state.userId, "specialist.completed", { specialistId: planned.id, label: planned.label, findingCount: result.findings.length }, `${planned.id}:completed`);
      return { result, sources: evidence.all() };
    } catch (error) {
      await markSpecialistProgress(state.runId, state.userId, planned, "failed", undefined, error instanceof Error ? error.message : "Specialist failed");
      await recordExecutionEvent(state.runId, state.userId, "specialist.failed", { specialistId: planned.id, label: planned.label, error: error instanceof Error ? error.message : "Specialist failed" }, `${planned.id}:failed`);
      throw error;
    }
  }));
  const successful = settled.flatMap(item => item.status === "fulfilled" ? [item.value] : []);
  if (successful.length < 2) throw new Error(`Only ${successful.length} specialists produced verified evidence; at least 2 are required.`);
  const sources = [...new Map(successful.flatMap(item => item.sources).map(source => [source.canonicalUrl, source])).values()];
  const results = successful.map(item => item.result);
  await recordExecutionEvent(state.runId, state.userId, "synthesis.started", { specialistCount: results.length, sourceCount: sources.length }, "synthesis.started");
  const report = await synthesizeReport({ runId: state.runId, skillIds: state.skillIds, query: state.query, specialistResults: results, sources, skillPrompts: state.skillIds.map(id => `${getSkill(id).instructions}\n${getSkill(id).synthesisPrompt}`) });
  const status = report.degraded || results.length < state.plan.specialists.length ? "partial" : "completed";
  await finishRun(state.runId, state.userId, status, report);
  await recordExecutionEvent(state.runId, state.userId, "run.completed", { status, sourceCount: sources.length }, "run.completed");
  return { results, sources, report };
}

export function createResearchGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(ResearchState).addNode("route", route).addNode("build_plan", plan).addNode("execute", execute).addEdge(START, "route").addEdge("route", "build_plan").addEdge("build_plan", "execute").addEdge("execute", END).compile({ checkpointer });
}
