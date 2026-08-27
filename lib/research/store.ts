import type { ResearchMode, RunStatus } from "@/lib/contracts";
export type RunRecord = { id: string; mode: ResearchMode; query: string; status: RunStatus; createdAt: string; progress: string[] };
const runs = new Map<string, RunRecord>();
export const runStore = {
  create(mode: ResearchMode, query: string) { const id = crypto.randomUUID(); const run: RunRecord = { id, mode, query, status: "queued", createdAt: new Date().toISOString(), progress: [] }; runs.set(id, run); return run; },
  get(id: string) { return runs.get(id); },
  cancel(id: string) { const run = runs.get(id); if (run && !["completed", "failed"].includes(run.status)) run.status = "cancelled"; return run; },
};
