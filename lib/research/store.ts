import type { ResearchMode, ResearchReport, RunStatus, SpecialistProgressState } from "@/lib/contracts";

export type SpecialistProgress = { id: string; state: SpecialistProgressState; detail?: string; updatedAt: string; error?: string };
export type RunRecord = { id: string; mode: ResearchMode; query: string; status: RunStatus; createdAt: string; updatedAt: string; specialists: SpecialistProgress[]; report?: ResearchReport; error?: string };
const runs = new Map<string, RunRecord>();
const terminal: RunStatus[] = ["completed", "partial", "failed", "cancelled"];

export const runStore = {
  create(mode: ResearchMode, query: string, specialistIds: string[] = []) {
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const run: RunRecord = { id, mode, query, status: "queued", createdAt: now, updatedAt: now, specialists: specialistIds.map(item => ({ id: item, state: "queued", updatedAt: now })) };
    runs.set(id, run); return run;
  },
  get(id: string) { return runs.get(id); },
  setStatus(id: string, status: RunStatus, values: Partial<Pick<RunRecord, "report" | "error">> = {}) { const run = runs.get(id); if (!run || run.status === "cancelled") return run; Object.assign(run, values, { status, updatedAt: new Date().toISOString() }); return run; },
  progress(id: string, specialistId: string, state: SpecialistProgressState, detail?: string, error?: string) {
    const run = runs.get(id); if (!run || terminal.includes(run.status)) return run;
    let specialist = run.specialists.find(item => item.id === specialistId);
    if (!specialist) { specialist = { id: specialistId, state, updatedAt: new Date().toISOString() }; run.specialists.push(specialist); }
    Object.assign(specialist, { state, detail, error, updatedAt: new Date().toISOString() }); run.updatedAt = new Date().toISOString(); return run;
  },
  cancel(id: string) { const run = runs.get(id); if (run && !terminal.includes(run.status)) { run.status = "cancelled"; run.updatedAt = new Date().toISOString(); } return run; },
};
