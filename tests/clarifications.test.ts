import { Command, MemorySaver } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routing = vi.hoisted(() => ({
  planResearch: vi.fn(),
  routeSkills: vi.fn(async () => ({ selections: [{ skillId: "general-research", confidence: 1, rationale: "test" }], clarification: null })),
}));

vi.mock("@/lib/skills/routing", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/skills/routing")>(),
  planResearch: routing.planResearch,
  routeSkills: routing.routeSkills,
}));

vi.mock("@/lib/research/postgres-persistence", () => ({
  finishRun: vi.fn(),
  markRunRunning: vi.fn(),
  markSpecialistProgress: vi.fn(),
  persistSpecialistResult: vi.fn(),
  recordExecutionEvent: vi.fn(),
}));

import { createResearchGraph } from "@/lib/research/graph";
import { CLARIFICATION_SOFT_LIMIT, clarificationPlanningGuidance } from "@/lib/skills/routing";

describe("research clarification cycles", () => {
  beforeEach(() => {
    routing.planResearch.mockReset();
    routing.planResearch.mockImplementation(async (_skillIds, _query, _history, clarificationRounds) => ({ questions: [`Question ${Number(clarificationRounds) + 1}`] }));
  });

  it("keeps checkpointing clarification rounds beyond the soft limit", async () => {
    const graph = createResearchGraph(new MemorySaver());
    const config = { configurable: { thread_id: crypto.randomUUID() } } as never;
    let result = await graph.invoke({ runId: crypto.randomUUID(), userId: crypto.randomUUID(), query: "Research this", history: [] }, config);

    expect(result.__interrupt__[0].value).toMatchObject({ clarificationRound: 1, questions: ["Question 1"] });
    for (let round = 1; round <= CLARIFICATION_SOFT_LIMIT + 1; round += 1) {
      result = await graph.invoke(new Command({ resume: `Answer ${round}` }), config);
      expect(result.__interrupt__[0].value).toMatchObject({ clarificationRound: round + 1, questions: [`Question ${round + 1}`] });
    }

    expect(routing.planResearch).toHaveBeenLastCalledWith(["general-research"], "Research this", expect.arrayContaining([{ role: "user", content: "Answer 6" }]), 6);
  });

  it("starts assumption guidance at five rounds without imposing a cap", () => {
    expect(clarificationPlanningGuidance(CLARIFICATION_SOFT_LIMIT - 1)).toBe("");
    expect(clarificationPlanningGuidance(CLARIFICATION_SOFT_LIMIT)).toMatch(/soft threshold, not a hard limit/i);
    expect(clarificationPlanningGuidance(12)).toMatch(/12 clarification rounds/);
  });
});
