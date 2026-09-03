import { Annotation, BaseCheckpointSaver, END, Send, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { PlannedSpecialist, ResearchPlan, ResearchReport, SpecialistResult, Source } from "@/lib/contracts";
import { routeSkills, planResearch } from "@/lib/skills/routing";
import { getSkill } from "@/lib/skills/loader";
import { runSpecialist, synthesizeReport } from "@/lib/research/agents";
import { EvidenceStore } from "@/lib/research/evidence";
import { markRunRunning, markSpecialistProgress, persistSpecialistResult, finishRun, recordExecutionEvent } from "@/lib/research/postgres-persistence";
import { canonicalizeUrl } from "@/lib/research/sources";

type SpecialistOutcome = { planned: PlannedSpecialist; result?: SpecialistResult; sources: Source[]; error?: string };

const ResearchState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  history: Annotation<Array<{ role: string; content: string }>>({ value: (_, next) => next, default: () => [] }),
  clarificationRounds: Annotation<number>({ value: (_, next) => next, default: () => 0 }),
  pendingQuestions: Annotation<string[]>({ value: (_, next) => next, default: () => [] }),
  skillIds: Annotation<string[]>({ value: (_, next) => next, default: () => [] }),
  plan: Annotation<ResearchPlan | null>({ value: (_, next) => next, default: () => null }),
  activeSpecialist: Annotation<PlannedSpecialist | null>({ value: (_, next) => next, default: () => null }),
  outcomes: Annotation<SpecialistOutcome[]>({ value: (current, next) => current.concat(next), default: () => [] }),
  results: Annotation<SpecialistResult[]>({ value: (_, next) => next, default: () => [] }),
  sources: Annotation<Source[]>({ value: (_, next) => next, default: () => [] }),
  report: Annotation<ResearchReport | null>({ value: (_, next) => next, default: () => null }),
});

export type ResearchGraphState = typeof ResearchState.State;

async function route(state: ResearchGraphState) {
  await recordExecutionEvent(state.runId, state.userId, "routing.started", {}, "routing.started");
  const routed = await routeSkills(state.query, state.history);
  await recordExecutionEvent(state.runId, state.userId, "routing.completed", { skillIds: routed.selections.map(item => item.skillId) }, "routing.completed");
  return { skillIds: routed.selections.map(item => item.skillId) };
}

async function buildPlan(state: ResearchGraphState) {
  const planned = await planResearch(state.skillIds, state.query, state.history, state.clarificationRounds);
  if (planned.questions?.length) return { pendingQuestions: planned.questions };
  if (!planned.plan) throw new Error("Research planner did not produce a plan");
  await markRunRunning(state.runId, state.userId, planned.plan);
  await recordExecutionEvent(state.runId, state.userId, "plan.completed", { specialistCount: planned.plan.specialists.length }, "plan.completed");
  return { plan: planned.plan, pendingQuestions: [], outcomes: [] };
}

function requestClarification(state: ResearchGraphState) {
  if (!state.pendingQuestions.length) throw new Error("Research clarification is missing its questions");
  const answer = interrupt({ questions: state.pendingQuestions, clarificationRound: state.clarificationRounds + 1 });
  return {
    history: [
      ...state.history,
      { role: "assistant", content: state.pendingQuestions.join("\n") },
      { role: "user", content: String(answer) },
    ],
    clarificationRounds: state.clarificationRounds + 1,
    pendingQuestions: [],
  };
}

function dispatchSpecialists(state: ResearchGraphState) {
  if (!state.plan) throw new Error("Research plan is missing");
  return state.plan.specialists.slice(0, 4).map(planned => new Send("specialist", { ...state, activeSpecialist: planned, outcomes: [] }));
}

function continueAfterPlanning(state: ResearchGraphState) {
  if (state.plan) return dispatchSpecialists(state);
  if (state.pendingQuestions.length) return "clarify";
  throw new Error("Research planner produced neither a plan nor clarification questions");
}

async function specialist(state: ResearchGraphState, config?: { signal?: AbortSignal }) {
  const planned = state.activeSpecialist;
  if (!planned) throw new Error("Specialist branch is missing its assignment");
  const definition = getSkill(planned.skillId).specialists.find(item => item.id === planned.id);
  if (!definition) return { outcomes: [{ planned, sources: [], error: `Specialist not found: ${planned.id}` }] };
  await markSpecialistProgress(state.runId, state.userId, planned, "planning", definition.mission);
  const evidence = new EvidenceStore(10);
  try {
    const onEvent = async (eventType: string, detail: Record<string, unknown>) => recordExecutionEvent(state.runId, state.userId, eventType, { specialistId: planned.id, ...detail });
    const result = await runSpecialist({ definition, query: state.query, userId: state.userId, runId: state.runId, evidence, abortSignal: config?.signal, onEvent, onProgress: async (status, detail) => {
      await markSpecialistProgress(state.runId, state.userId, planned, status, detail);
      await recordExecutionEvent(state.runId, state.userId, `specialist.${status}`, { specialistId: planned.id, label: planned.label, detail }, `${planned.id}:${status}`);
    } });
    await persistSpecialistResult(state.runId, state.userId, result, evidence.all());
    await recordExecutionEvent(state.runId, state.userId, "specialist.completed", { specialistId: planned.id, label: planned.label, findingCount: result.findings.length, sourceCount: evidence.all().length }, `${planned.id}:completed`);
    return { outcomes: [{ planned, result, sources: evidence.all() }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Specialist failed";
    await markSpecialistProgress(state.runId, state.userId, planned, "failed", undefined, message);
    await recordExecutionEvent(state.runId, state.userId, "specialist.failed", { specialistId: planned.id, label: planned.label, error: message }, `${planned.id}:failed`);
    return { outcomes: [{ planned, sources: evidence.all(), error: message }] };
  }
}

function aggregateSources(outcomes: SpecialistOutcome[]) {
  const found = new Map<string, Source>();
  const aliases = new Map<string, string>();
  const ranked = outcomes.flatMap(outcome => outcome.sources).sort((a, b) => ((b as Source & { deterministicScore?: number }).deterministicScore ?? 0) - ((a as Source & { deterministicScore?: number }).deterministicScore ?? 0) || a.canonicalUrl.localeCompare(b.canonicalUrl));
  for (const source of ranked) {
    let key: string;
    try { key = canonicalizeUrl(source.canonicalUrl); } catch { continue; }
    const retained = found.get(key);
    if (retained) aliases.set(source.id, retained.id);
    else { found.set(key, { ...source, canonicalUrl: key }); aliases.set(source.id, source.id); }
  }
  const sources = [...found.values()].slice(0, 20);
  const retainedIds = new Set(sources.map(source => source.id));
  for (const [sourceId, retainedId] of aliases) if (!retainedIds.has(retainedId)) aliases.delete(sourceId);
  return { sources, aliases };
}

async function aggregate(state: ResearchGraphState, config?: { signal?: AbortSignal }) {
  if (!state.plan) throw new Error("Research plan is missing");
  const successful = state.outcomes.filter((outcome): outcome is SpecialistOutcome & { result: SpecialistResult } => Boolean(outcome.result));
  if (successful.length < 2) throw new Error(`Only ${successful.length} specialists produced verified evidence; at least 2 are required.`);
  const { sources, aliases } = aggregateSources(successful);
  const sourceIds = new Set(sources.map(source => source.id));
  const results = successful.map(outcome => ({ ...outcome.result, findings: outcome.result.findings.map(finding => ({ ...finding, sourceIds: [...new Set(finding.sourceIds.map(id => aliases.get(id)).filter((id): id is string => Boolean(id)))] })).filter(finding => finding.sourceIds.length > 0 && finding.sourceIds.every(id => sourceIds.has(id))) })).filter(result => result.findings.length > 0);
  if (results.length < 2) throw new Error(`Only ${results.length} specialists retained evidence after the global 20-source cap; at least 2 are required.`);
  await recordExecutionEvent(state.runId, state.userId, "synthesis.started", { specialistCount: results.length, sourceCount: sources.length }, "synthesis.started");
  const onEvent = async (eventType: string, detail: Record<string, unknown>) => recordExecutionEvent(state.runId, state.userId, eventType, detail);
  const report = await synthesizeReport({ runId: state.runId, userId: state.userId, skillIds: state.skillIds, query: state.query, specialistResults: results, sources, skillPrompts: state.skillIds.map(id => `${getSkill(id).instructions}\n${getSkill(id).synthesisPrompt}`), abortSignal: config?.signal, onEvent });
  const status = report.degraded || results.length < state.plan.specialists.length ? "partial" : "completed";
  await finishRun(state.runId, state.userId, status, report);
  await recordExecutionEvent(state.runId, state.userId, "run.completed", { status, sourceCount: sources.length }, "run.completed");
  return { results, sources, report };
}

export function createResearchGraph(checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(ResearchState)
    .addNode("route", route)
    .addNode("build_plan", buildPlan)
    .addNode("clarify", requestClarification)
    .addNode("specialist", specialist)
    .addNode("aggregate", aggregate)
    .addEdge(START, "route")
    .addEdge("route", "build_plan")
    .addConditionalEdges("build_plan", continueAfterPlanning, ["clarify", "specialist"])
    .addEdge("clarify", "build_plan")
    .addEdge("specialist", "aggregate")
    .addEdge("aggregate", END)
    .compile({ checkpointer });
}
