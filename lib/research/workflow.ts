import { inngest } from "@/lib/inngest";
import type { ResearchMode, SpecialistResult } from "@/lib/contracts";
import { EvidenceStore } from "@/lib/research/evidence";
import { getResearchAgent } from "@/lib/agents/registry";
import { runStore } from "@/lib/research/store";

export const deepResearch = inngest.createFunction(
  { id: "deep-research", retries: 3, cancelOn: [{ event: "research/cancelled", match: "data.runId" }] },
  { event: "research/requested" },
  async ({ event, step }) => {
    const mode = event.data.mode as ResearchMode; const runId = event.data.runId as string; const query = event.data.query as string;
    const agent = getResearchAgent(mode); const definition = agent.definition; const evidence = new EvidenceStore(20);
    runStore.setStatus(runId, "running");
    const settled = await Promise.allSettled(definition.specialists.map(specialist => step.run(`specialist-${specialist.id}`, async () => {
      try {
        const result = await agent.runLens(specialist, { query, evidence, onProgress: (state, detail) => { runStore.progress(runId, specialist.id, state, detail); } });
        runStore.progress(runId, specialist.id, "completed", `${result.findings.length} verified findings`); return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Specialist failed"; runStore.progress(runId, specialist.id, "failed", undefined, message); throw error;
      }
    })));
    const completed = settled.flatMap(result => result.status === "fulfilled" ? [result.value as SpecialistResult] : []);
    if (completed.length < 2) { const message = "Fewer than two specialists met the evidence threshold"; runStore.setStatus(runId, "failed", { error: message }); return { runId, mode, specialistsCompleted: completed.length, status: "failed", error: message }; }
    const sources = evidence.all();
    try {
      const report = await step.run("synthesize-report", () => agent.synthesize({ runId, query, specialistResults: completed, sources }));
      const status = completed.length === 3 ? "completed" : "partial"; runStore.setStatus(runId, status, { report });
      return { runId, mode, specialistsCompleted: completed.length, status, reportId: report.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Synthesis failed"; runStore.setStatus(runId, "failed", { error: message }); throw error;
    }
  },
);

export const refreshHub = inngest.createFunction({ id: "refresh-hub", retries: 3 }, { event: "hub/refresh.requested" }, async ({ event, step }) =>
  step.run(`refresh-${event.data.hub}`, async () => ({ hub: event.data.hub, refreshedAt: new Date().toISOString() })),
);
export const functions = [deepResearch, refreshHub];
