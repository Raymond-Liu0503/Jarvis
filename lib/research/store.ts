import type { ResearchPlan, ResearchReport, RunStatus, SkillId, SpecialistProgressState } from "@/lib/contracts";
import { RESEARCH_RUN_TIMEOUT_MS } from "@/lib/research/limits";
export type SpecialistProgress = { id: string; label: string; state: SpecialistProgressState; detail?: string; updatedAt: string; error?: string };
export type RunRecord = { id: string; threadId: string; skillIds: SkillId[]; query: string; plan: ResearchPlan; status: RunStatus; createdAt: string; updatedAt: string; deadlineAt: string; specialists: SpecialistProgress[]; report?: ResearchReport; error?: string };
export type MessageRecord = { id: string; threadId: string; role: "user" | "assistant"; content: string; createdAt: string };
export type ThreadRecord = { id: string; title: string; createdAt: string; messages: MessageRecord[] };
export type TraceEvent = { id: string; threadId: string; runId?: string; type: string; detail: Record<string, unknown>; createdAt: string };
type ResearchState = { runs: Map<string, RunRecord>; threads: Map<string, ThreadRecord>; traces: TraceEvent[] };
const globalResearchState = globalThis as typeof globalThis & { __jarvisResearchState?: ResearchState };
const state: ResearchState = globalResearchState.__jarvisResearchState ?? { runs: new Map<string, RunRecord>(), threads: new Map<string, ThreadRecord>(), traces: [] };
globalResearchState.__jarvisResearchState = state;
const { runs, threads, traces } = state; const terminal: RunStatus[] = ["completed", "partial", "failed", "cancelled"];
export const conversationStore = {
  ensure(threadId?: string, firstMessage = "New research") { if (threadId && threads.has(threadId)) return threads.get(threadId)!; const id = crypto.randomUUID(); const thread = { id, title: firstMessage.slice(0, 80), createdAt: new Date().toISOString(), messages: [] }; threads.set(id, thread); return thread; },
  restore(id: string, title = "Research conversation") { const existing = threads.get(id); if (existing) return existing; const thread: ThreadRecord = { id, title: title.slice(0, 80), createdAt: new Date().toISOString(), messages: [] }; threads.set(id, thread); return thread; },
  add(threadId: string, role: MessageRecord["role"], content: string) { const thread = threads.get(threadId); if (!thread) throw new Error("Thread not found"); const message = { id: crypto.randomUUID(), threadId, role, content, createdAt: new Date().toISOString() }; thread.messages.push(message); return message; },
  context(threadId: string) { const messages = threads.get(threadId)?.messages.slice(-12) ?? []; let size = 0; return messages.reverse().filter(message => { size += message.content.length; return size <= 12_000; }).reverse(); }, get: (id: string) => threads.get(id),
};
export const traceStore = { add(threadId: string, type: string, detail: Record<string, unknown>, runId?: string) { const event = { id: crypto.randomUUID(), threadId, runId, type, detail, createdAt: new Date().toISOString() }; traces.push(event); return event; }, forThread(threadId: string) { return traces.filter(item => item.threadId === threadId); } };
export const runStore = {
  create(threadId: string, query: string, plan: ResearchPlan) { const id = crypto.randomUUID(); const now = new Date().toISOString(); const run: RunRecord = { id, threadId, skillIds: plan.skillIds, query, plan, status: "queued", createdAt: now, updatedAt: now, deadlineAt: new Date(Date.now() + RESEARCH_RUN_TIMEOUT_MS).toISOString(), specialists: plan.specialists.map(item => ({ id: item.id, label: item.label, state: "queued", detail: item.focus, updatedAt: now })) }; runs.set(id, run); return run; },
  restore(snapshot: RunRecord) { const existing = runs.get(snapshot.id); if (existing) return existing; const run = structuredClone(snapshot); runs.set(run.id, run); return run; },
  get(id: string) { return this.expire(id); },
  expire(id: string, now = Date.now()) { const run = runs.get(id); if (run && !terminal.includes(run.status) && now >= Date.parse(run.deadlineAt)) { run.status = "failed"; run.error = "Deep Research timed out after 5 minutes. Check provider availability before retrying."; run.updatedAt = new Date(now).toISOString(); } return run; },
  setStatus(id: string, status: RunStatus, values: Partial<Pick<RunRecord, "report" | "error">> = {}) { const run = runs.get(id); if (!run || run.status === "cancelled") return run; Object.assign(run, values, { status, updatedAt: new Date().toISOString() }); return run; },
  progress(id: string, specialistId: string, state: SpecialistProgressState, detail?: string, error?: string) { const run = runs.get(id); if (!run || terminal.includes(run.status)) return run; const specialist = run.specialists.find(item => item.id === specialistId); if (specialist) Object.assign(specialist, { state, detail, error, updatedAt: new Date().toISOString() }); run.updatedAt = new Date().toISOString(); return run; },
  cancel(id: string) { const run = runs.get(id); if (run && !terminal.includes(run.status)) { run.status = "cancelled"; run.updatedAt = new Date().toISOString(); } return run; },
};
