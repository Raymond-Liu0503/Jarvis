import { describe, expect, it } from "vitest";
import { isExpired, priceChangePercent } from "@/lib/config";
import { classifyHub, validateIntake } from "@/lib/research/intake";
import { canonicalizeUrl, deduplicateSources, hasCitationCoverage } from "@/lib/research/sources";
import { MODE_DEFINITIONS } from "@/lib/research/modes";
import { agentRegistry } from "@/lib/agents/registry";
import { loadAgentConfig } from "@/lib/agents/config-loader";
import type { Source } from "@/lib/contracts";
import { EvidenceStore, ToolCallBudget } from "@/lib/research/evidence";

describe("agent registry and manifests", () => {
  it("defines exactly three domain agents and three lenses per agent", () => { expect(Object.keys(agentRegistry)).toEqual(["stocks", "travel", "shopping"]); for (const agent of Object.values(agentRegistry)) expect(agent.lenses).toHaveLength(3); });
  it("loads versioned prompts and validates lens tool subsets", () => { for (const agent of Object.values(agentRegistry)) for (const lens of agent.lenses) { expect(lens.promptVersion).toMatch(/^\d+\.\d+\.\d+$/); expect(lens.systemPrompt.length).toBeGreaterThan(100); expect(lens.maxToolRounds).toBe(3); expect(lens.tools.every(tool => new Set<string>(agent.definition.tools).has(tool))).toBe(true); } });
  it("loads all prompt files from YAML manifests", () => { expect(loadAgentConfig("finance").synthesisPrompt.length).toBeGreaterThan(100); expect(MODE_DEFINITIONS.stocks.specialists).toHaveLength(3); });
  it("makes web search available to every lens", () => { for (const agent of Object.values(agentRegistry)) for (const lens of agent.lenses) expect(lens.tools).toContain("webSearch"); });
});
describe("routing and intake", () => {
  it("routes confident requests", () => expect(classifyHub("plan a travel itinerary to Lisbon")).toMatchObject({ mode: "travel", confidence: .82 }));
  it("defers ambiguous requests", () => expect(classifyHub("help me decide").mode).toBeNull());
  it("requests missing travel dates", () => expect(validateIntake("travel", "trip to Lisbon").missing).toContain("dates"));
});
describe("freshness and commerce", () => {
  it("marks expiry", () => expect(isExpired("2020-01-01T00:00:00.000Z")).toBe(true));
  it("calculates price changes", () => expect(priceChangePercent(90, 100)).toBe(-10));
});
describe("evidence", () => {
  const source: Source = { id: "s1", canonicalUrl: "https://Example.com/story?utm_source=x", title: "Story", publisher: "Example", publishedAt: null, retrievedAt: "2026-01-01T00:00:00.000Z", excerpt: "Evidence", type: "web" };
  it("canonicalizes and deduplicates sources", () => { expect(canonicalizeUrl(source.canonicalUrl)).toBe("https://example.com/story"); expect(deduplicateSources([source, { ...source, id: "s2" }])).toHaveLength(1); });
  it("requires source ids for every finding", () => expect(hasCitationCoverage([{ specialist: "fit", claim: "x", confidence: .8, sourceIds: ["s1"], caveats: [] }], [source])).toBe(true));
  it("rejects missing and unknown citation ids", () => { expect(hasCitationCoverage([{ specialist: "fit", claim: "x", confidence: .8, sourceIds: [], caveats: [] }], [source])).toBe(false); expect(hasCitationCoverage([{ specialist: "fit", claim: "x", confidence: .8, sourceIds: ["missing"], caveats: [] }], [source])).toBe(false); });
  it("deduplicates and caps shared run evidence", () => { const store = new EvidenceStore(2); store.add([source, { ...source, id: "duplicate" }, { ...source, id: "s2", canonicalUrl: "https://example.com/two" }, { ...source, id: "s3", canonicalUrl: "https://example.com/three" }]); expect(store.all().map(item => item.id)).toEqual(["s1", "s2"]); });
  it("enforces tool-call budgets", () => { const budget = new ToolCallBudget(1); budget.take(); expect(() => budget.take()).toThrow(/exhausted/); });
});
