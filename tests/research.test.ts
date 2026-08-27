import { describe, expect, it } from "vitest";
import { isExpired, priceChangePercent } from "@/lib/config";
import { classifyHub, validateIntake } from "@/lib/research/intake";
import { canonicalizeUrl, deduplicateSources, hasCitationCoverage } from "@/lib/research/sources";
import { MODE_DEFINITIONS } from "@/lib/research/modes";
import type { Source } from "@/lib/contracts";

describe("mode registry", () => { it("defines exactly three specialists per mode", () => { for (const mode of Object.values(MODE_DEFINITIONS)) expect(mode.specialists).toHaveLength(3); }); });
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
});
