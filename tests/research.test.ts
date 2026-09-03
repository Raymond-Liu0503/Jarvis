import { describe, expect, it } from "vitest";
import { isExpired, priceChangePercent } from "@/lib/config";
import { canonicalizeUrl, deduplicateSources, hasCitationCoverage } from "@/lib/research/sources";
import { EvidenceStore, ToolCallBudget } from "@/lib/research/evidence";
import { getSkill, loadSkills, skillCatalog } from "@/lib/skills/loader";
import { CLARIFICATION_SOFT_LIMIT, clarificationPlanningGuidance, hasExplicitIntakeValue, heuristicRoute, planResearch } from "@/lib/skills/routing";
import type { Source } from "@/lib/contracts";
import { classifyFailure, retryDelayMs, sanitizeError, IdempotencyConflictError } from "@/lib/research/queue";
import { isOperator } from "@/lib/operator-auth";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { registeredJobKinds, usesCheckpointResume } from "@/worker/index";
import { fallbackSpecialistResult, searchOptionsFor, specialistSourceTarget, structuredToolsFor } from "@/lib/research/agents";
import { recoverObjectFromText } from "@/lib/research/structured-output";
import { specialistResultSchema } from "@/lib/contracts";
import { quickEvidenceFallback, quickToolErrorMessage } from "@/lib/research/quick-fallback";
describe("skill packages", () => {
  it("auto-discovers three domains and the fallback", () => expect([...loadSkills().keys()].sort()).toEqual(["general-research", "product-research", "stock-analysis", "travel-planning"]));
  it("keeps routing metadata cheap", () => expect(skillCatalog().every(item => Object.keys(item).length === 2)).toBe(true));
  it("loads versioned references and namespaced lenses", () => { for (const skill of loadSkills().values()) { expect(skill.instructions.length).toBeGreaterThan(80); expect(skill.specialists.length).toBeGreaterThanOrEqual(3); for (const lens of skill.specialists) { expect(lens.id.startsWith(`${skill.id}/`)).toBe(true); expect(lens.systemPrompt.length).toBeGreaterThan(60); expect(lens.tools.every(tool => skill.tools.includes(tool))).toBe(true); } } });
  it("upgrades every skill package and keeps specialist retrieval at four sources", () => { for (const skill of loadSkills().values()) { expect(skill.version).toBe("1.2.0"); for (const lens of skill.specialists) expect(specialistSourceTarget(lens)).toBe(4); } });
  it("enables bounded structured travel research without enabling booking", () => { const skill = getSkill("travel-planning"); expect(skill.tools).toEqual(expect.arrayContaining(["routes", "travelRequirements"])); expect(skill.tools).not.toContain("commerceSnapshot"); expect(skill.specialists.find(item => item.id.endsWith("/logistics"))?.maxToolRounds).toBe(3); });
  it("falls back and composes obvious domains", () => { expect(heuristicRoute("Explain photosynthesis").selections[0].skillId).toBe("general-research"); expect(heuristicRoute("Compare travel headphones for my trip").selections.map(item => item.skillId)).toEqual(["travel-planning", "product-research"]); });
  it("does not route stock purchase language to product research", () => expect(heuristicRoute("Should I buy MRVL stock at this price?").selections.map(item => item.skillId)).toEqual(["stock-analysis"]));
  it("recognizes a named company as satisfying stock intake", () => {
    expect(hasExplicitIntakeValue("stock-analysis", "company", "Should I buy Marvell stock now?")).toBe(true);
    expect(hasExplicitIntakeValue("stock-analysis", "company", "Is marvell a good stock to buy today?")).toBe(true);
    expect(hasExplicitIntakeValue("stock-analysis", "company", "Should I buy this stock?")).toBe(false);
  });
  it("creates a bounded balanced plan without models", async () => { const result = await planResearch(["stock-analysis", "travel-planning"], "AAPL around my Lisbon trip", []); expect(result.plan?.specialists.length).toBeGreaterThanOrEqual(3); expect(result.plan?.specialists.length).toBeLessThanOrEqual(4); expect(new Set(result.plan?.specialists.map(item => item.skillId))).toEqual(new Set(["stock-analysis", "travel-planning"])); });
  it("uses five clarification rounds as guidance rather than a hard limit", () => { expect(CLARIFICATION_SOFT_LIMIT).toBe(5); expect(clarificationPlanningGuidance(4)).toBe(""); expect(clarificationPlanningGuidance(5)).toMatch(/soft threshold, not a hard limit/i); expect(clarificationPlanningGuidance(12)).toMatch(/12 clarification rounds/); });
  it("loads the required fallback", () => expect(getSkill("general-research").tools).toEqual(["webSearch"]));
  it("classifies deterministic failures as terminal and transient failures as retryable", () => { expect(classifyFailure(new Error("Invalid job payload")).retryable).toBe(false); expect(classifyFailure(new Error("provider connection reset")).retryable).toBe(true); });
  it("keeps exponential retry jitter within 25 percent", () => { expect(retryDelayMs(3, () => 0)).toBe(4_000); expect(retryDelayMs(3, () => 1)).toBe(5_000); expect(retryDelayMs(20, () => 1)).toBe(75_000); });
  it("redacts and caps stored errors", () => { const clean = sanitizeError(new Error(`api_key=secret-value ${"x".repeat(3_000)}`)); expect(clean.message).not.toContain("secret-value"); expect(clean.message.length).toBeLessThanOrEqual(2_048); });
  it("distinguishes strict idempotency conflicts", () => expect(new IdempotencyConflictError().name).toBe("IdempotencyConflictError"));
  it("authorizes only app-metadata operators", () => { expect(isOperator({ app_metadata: { role: "operator" } } as never)).toBe(true); expect(isOperator({ app_metadata: { role: "user" } } as never)).toBe(false); expect(isOperator(null)).toBe(false); });
  it("validates database pool capacity against concurrency", () => expect(() => getRuntimeConfig({ WORKER_CONCURRENCY: "4", DATABASE_POOL_MAX: "4" } as unknown as NodeJS.ProcessEnv)).toThrow(/DATABASE_POOL_MAX/));
  it("allows an empty optional worker ID so the process identity default is used", () => expect(getRuntimeConfig({ WORKER_ID: "" } as unknown as NodeJS.ProcessEnv).WORKER_ID).toBeUndefined());
  it("dispatches only controlled kinds and checkpoint-resumes retries and replays", () => { expect(registeredJobKinds).toEqual(["research.start", "research.resume"]); expect(usesCheckpointResume({ attempts: 1, replayedFromJobId: null })).toBe(false); expect(usesCheckpointResume({ attempts: 2, replayedFromJobId: null })).toBe(true); expect(usesCheckpointResume({ attempts: 1, replayedFromJobId: crypto.randomUUID() })).toBe(true); });
  it("recovers malformed specialist output using only cited evidence", () => { const lens = getSkill("general-research").specialists[0]; const sources: Source[] = ["one", "two"].map((id, index) => ({ id, canonicalUrl: `https://example.com/${id}`, title: id, publisher: "Example", publishedAt: null, retrievedAt: "2026-01-01T00:00:00.000Z", excerpt: `Verified evidence excerpt ${index + 1}`, type: "web" })); const result = fallbackSpecialistResult(lens, sources); expect(result.limitations[0]).toMatch(/Degraded/); expect(result.findings.map(item => item.sourceIds[0])).toEqual(["one", "two"]); expect(hasCitationCoverage(result.findings, sources)).toBe(true); });
  it("recovers schema-valid JSON with a malformed model prefix", () => { const malformed = `{"{"specialist":"product-research/reliability","summary":"Recovered","findings":[],"limitations":[]}`; expect(recoverObjectFromText(malformed, specialistResultSchema)).toMatchObject({ specialist: "product-research/reliability", summary: "Recovered" }); expect(recoverObjectFromText('{"query":"not a specialist result"}', specialistResultSchema)).toBeUndefined(); });
  it("recovers a valid object before malformed trailing text", () => { const text = '{"specialist":"stock-analysis/market","summary":"Recovered","findings":[],"limitations":[]} trailing {"'; expect(recoverObjectFromText(text, specialistResultSchema)?.summary).toBe("Recovered"); });
  it("does not treat an empty model response as structured output", () => { expect(recoverObjectFromText("", specialistResultSchema)).toBeUndefined(); });
});

describe("table-driven skill behavior", () => {
  const cases: Array<{ name: string; check: () => void }> = [
    { name: "general routes stable explanatory questions to the fallback", check: () => expect(heuristicRoute("Explain how photosynthesis works").selections.map(item => item.skillId)).toEqual(["general-research"]) },
    { name: "general exposes evidence context and verification lenses", check: () => expect(getSkill("general-research").specialists.map(item => item.id.split("/")[1])).toEqual(["evidence", "context", "verification"]) },
    { name: "general comparisons do not masquerade as product shopping", check: () => expect(heuristicRoute("Compare the leading theories of memory").selections.map(item => item.skillId)).toEqual(["general-research"]) },
    { name: "product routes exact consumer comparisons and exposes all lenses", check: () => { expect(heuristicRoute("Compare Sony and Bose headphones").selections.map(item => item.skillId)).toEqual(["product-research"]); expect(getSkill("product-research").specialists.map(item => item.id.split("/")[1])).toEqual(["fit", "price", "reliability"]); } },
    { name: "product requirements are conditionally required and detectable", check: () => { const field = getSkill("product-research").intake.find(item => item.id === "requirements"); expect(field?.requiredWhen).toMatch(/change product fit/i); expect(hasExplicitIntakeValue("product-research", "requirements", "I need headphones under $300 for flights")).toBe(true); expect(hasExplicitIntakeValue("product-research", "requirements", "Recommend headphones")).toBe(false); } },
    { name: "product and travel compose for trip gear", check: () => expect(heuristicRoute("Compare travel headphones for my trip").selections.map(item => item.skillId)).toEqual(["travel-planning", "product-research"]) },
    { name: "stock routes purchase language only to securities analysis", check: () => { expect(heuristicRoute("Should I buy MRVL stock at this price?").selections.map(item => item.skillId)).toEqual(["stock-analysis"]); expect(getSkill("stock-analysis").specialists.map(item => item.id.split("/")[1])).toEqual(["fundamentals", "market", "risk"]); } },
    { name: "stock accepts exact securities and rejects ambiguous references", check: () => { expect(hasExplicitIntakeValue("stock-analysis", "company", "Analyze $MRVL")).toBe(true); expect(hasExplicitIntakeValue("stock-analysis", "company", "Analyze this stock")).toBe(false); } },
    { name: "stock and travel compose without product leakage", check: () => expect(heuristicRoute("Analyze AAPL stock before my Lisbon trip").selections.map(item => item.skillId)).toEqual(["stock-analysis", "travel-planning"]) },
    { name: "travel routes dated itinerary requests", check: () => expect(heuristicRoute("Plan a trip to Lisbon next April").selections.map(item => item.skillId)).toEqual(["travel-planning"]) },
    { name: "travel origin and traveler constraints are conditional", check: () => { const skill = getSkill("travel-planning"); expect(skill.intake.find(item => item.id === "origin")?.requiredWhen).toMatch(/routing/i); expect(skill.intake.find(item => item.id === "traveller-constraints")?.requiredWhen).toMatch(/entry/i); expect(hasExplicitIntakeValue("travel-planning", "origin", "Fly from Toronto to Lisbon")).toBe(true); expect(hasExplicitIntakeValue("travel-planning", "traveller-constraints", "Two Canadian passport holders, one wheelchair user")).toBe(true); } },
    { name: "travel exposes logistics destination and budget lenses", check: () => expect(getSkill("travel-planning").specialists.map(item => item.id.split("/")[1])).toEqual(["logistics", "destination", "budget"]) },
  ];

  it.each(cases)("$name", ({ check }) => check());
});
describe("freshness and evidence", () => {
  const source: Source = { id: "s1", canonicalUrl: "https://Example.com/story?utm_source=x", title: "Story", publisher: "Example", publishedAt: null, retrievedAt: "2026-01-01T00:00:00.000Z", excerpt: "Evidence", type: "web" };
  it("handles freshness and price changes", () => { expect(isExpired("2020-01-01T00:00:00.000Z")).toBe(true); expect(priceChangePercent(90, 100)).toBe(-10); });
  it("applies strict recency and live-content settings to market news", () => { const lens = getSkill("stock-analysis").specialists.find(item => item.id.endsWith("/market"))!; expect(searchOptionsFor(lens, new Date("2026-08-27T16:00:00.000Z"))).toEqual({ category: "news", startPublishedDate: "2026-07-28T16:00:00.000Z", endPublishedDate: "2026-08-27T16:00:00.000Z", maxAgeHours: 1 }); });
  it("does not force content recrawling for static research lenses", () => {
    const staticLenses = [
      ...getSkill("general-research").specialists,
      getSkill("product-research").specialists.find(item => item.id.endsWith("/fit"))!,
      getSkill("product-research").specialists.find(item => item.id.endsWith("/reliability"))!,
      getSkill("stock-analysis").specialists.find(item => item.id.endsWith("/fundamentals"))!,
      getSkill("stock-analysis").specialists.find(item => item.id.endsWith("/risk"))!,
    ];
    expect(staticLenses.every(lens => searchOptionsFor(lens).maxAgeHours === undefined)).toBe(true);
  });
  it("canonicalizes and deduplicates", () => { expect(canonicalizeUrl(source.canonicalUrl)).toBe("https://example.com/story"); expect(deduplicateSources([source, { ...source, id: "s2" }])).toHaveLength(1); });
  it("enforces citation coverage", () => { expect(hasCitationCoverage([{ specialist: "fit", claim: "x", confidence: .8, sourceIds: ["s1"], caveats: [] }], [source])).toBe(true); expect(hasCitationCoverage([{ specialist: "fit", claim: "x", confidence: .8, sourceIds: [], caveats: [] }], [source])).toBe(false); });
  it("enforces evidence and call budgets", () => { const store = new EvidenceStore(2); expect(store.reserve(2)).toBe(2); store.release(1); expect(store.reserve(1)).toBe(1); store.add([source, { ...source, id: "duplicate" }, { ...source, id: "s2", canonicalUrl: "https://example.com/two" }]); expect(store.all()).toHaveLength(2); const budget = new ToolCallBudget(1); budget.take(); expect(() => budget.take()).toThrow(/exhausted/); });
  it("separates the mandatory web pass from optional structured tools", () => { const tools = { web_research: {}, weather_forecast: {}, routes: {} } as never; expect(Object.keys(structuredToolsFor(tools))).toEqual(["weather_forecast", "routes"]); });
  it("builds a visible evidence fallback for an empty quick-chat completion", () => expect(quickEvidenceFallback([source])).toContain(`[${source.id}]`));
  it("preserves bounded provider details for Quick Chat tool failures", () => { const message = quickToolErrorMessage("market_quote", new Error("rate limited")); expect(message).toBe("market_quote failed: rate limited"); expect(quickToolErrorMessage("x", "z".repeat(1_000))).toHaveLength(500); });
});
