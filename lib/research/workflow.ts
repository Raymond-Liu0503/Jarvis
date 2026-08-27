import { inngest } from "@/lib/inngest";
import { MODE_DEFINITIONS } from "@/lib/research/modes";

export const deepResearch = inngest.createFunction(
  { id: "deep-research", retries: 3, cancelOn: [{ event: "research/cancelled", match: "data.runId" }] },
  { event: "research/requested" },
  async ({ event, step }) => {
    const mode = event.data.mode as keyof typeof MODE_DEFINITIONS; const definition = MODE_DEFINITIONS[mode];
    const results = await Promise.all(definition.specialists.map(specialist => step.run(`specialist-${specialist.id}`, async () => ({ specialist: specialist.id, findings: [], sources: [] }))));
    return step.run("synthesize-report", async () => ({ runId: event.data.runId, mode, specialistsCompleted: results.length, status: results.length === 3 ? "completed" : results.length >= 2 ? "partial" : "failed" }));
  },
);

export const refreshHub = inngest.createFunction({ id: "refresh-hub", retries: 3 }, { event: "hub/refresh.requested" }, async ({ event, step }) =>
  step.run(`refresh-${event.data.hub}`, async () => ({ hub: event.data.hub, refreshedAt: new Date().toISOString() })),
);
export const functions = [deepResearch, refreshHub];
