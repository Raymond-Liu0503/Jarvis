import { afterEach, describe, expect, it, vi } from "vitest";
import { excerptFromExaResult, exaSearchProvider, type ExaSearchCandidate } from "@/lib/providers/exa";
import { assertModelInputBudget, compactSources, estimateTokens, MODEL_INPUT_TOKEN_LIMIT, truncateText } from "@/lib/research/context-budget";
import { classifyWebResearchError, rankWebCandidates, runWebResearch, webResearchCacheKey } from "@/lib/research/web-research";
import type { Source } from "@/lib/contracts";

const now = "2026-08-28T12:00:00.000Z";
const candidate = (id: string, url: string, rank: number, excerpt = "useful evidence"): ExaSearchCandidate => ({ id, url, rank, excerpt, title: `Source ${id}`, publishedAt: now, retrievedAt: now, highlightScore: .8 });

afterEach(() => vi.restoreAllMocks());

describe("bounded web research", () => {
  it("caps Exa highlight arrays before they enter research context", () => {
    expect(excerptFromExaResult({ highlights: ["x".repeat(2_000)] })).toHaveLength(800);
  });

  it("deduplicates URLs, limits domains, and ranks stably", () => {
    const ranked = rankWebCandidates({ query: "official climate evidence", objective: "verify evidence", startPublishedDate: "2026-01-01T00:00:00.000Z" }, [
      candidate("a", "https://example.com/a?utm_source=test", 0, "official climate evidence"),
      candidate("duplicate", "https://example.com/a", 1),
      candidate("b", "https://example.com/b", 2),
      candidate("c", "https://example.com/c", 3),
      candidate("gov", "https://agency.gov/report", 4, "official climate evidence"),
    ]);
    expect(ranked.map(item => item.candidate.id)).not.toContain("duplicate");
    expect(ranked.filter(item => new URL(item.candidate.url).hostname === "example.com")).toHaveLength(2);
    expect(ranked[0].candidate.id).toBe("a");
  });

  it("uses one provider request and returns at most ten compact sources without a reranker", async () => {
    const candidates = Array.from({ length: 14 }, (_, index) => candidate(String(index), `https://source${index}.example/article`, index, "z".repeat(2_000)));
    const search = vi.spyOn(exaSearchProvider, "searchCandidates").mockResolvedValue(candidates);
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousDatabase = process.env.DATABASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DATABASE_URL;
    try {
      const result = await runWebResearch({ userId: "00000000-0000-0000-0000-000000000001", query: "bounded test query", limit: 10 });
      expect(search).toHaveBeenCalledTimes(1);
      expect(result.results).toHaveLength(10);
      expect(result.results.every(source => source.excerpt.length <= 800)).toBe(true);
      expect(result.reranked).toBe(false);
    } finally {
      if (previousKey) process.env.OPENROUTER_API_KEY = previousKey;
      if (previousDatabase) process.env.DATABASE_URL = previousDatabase;
    }
  });

  it("keeps model reranking disabled by default even when a reranker model is configured", async () => {
    const search = vi.spyOn(exaSearchProvider, "searchCandidates").mockResolvedValue([
      candidate("a", "https://first.example/article", 0),
      candidate("b", "https://second.example/article", 1),
    ]);
    const previous = {
      apiKey: process.env.OPENROUTER_API_KEY,
      database: process.env.DATABASE_URL,
      enabled: process.env.WEB_RESEARCH_RERANK_ENABLED,
      model: process.env.MODEL_WEB_RESEARCH,
    };
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.MODEL_WEB_RESEARCH = "test/reranker";
    delete process.env.WEB_RESEARCH_RERANK_ENABLED;
    delete process.env.DATABASE_URL;
    try {
      const result = await runWebResearch({ userId: "00000000-0000-0000-0000-000000000001", query: "default reranking test" });
      expect(search).toHaveBeenCalledTimes(1);
      expect(result.reranked).toBe(false);
    } finally {
      if (previous.apiKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous.apiKey;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.enabled === undefined) delete process.env.WEB_RESEARCH_RERANK_ENABLED;
      else process.env.WEB_RESEARCH_RERANK_ENABLED = previous.enabled;
      if (previous.model === undefined) delete process.env.MODEL_WEB_RESEARCH;
      else process.env.MODEL_WEB_RESEARCH = previous.model;
    }
  });

  it("normalizes equivalent cache inputs", () => {
    const base = { userId: "u", query: "  Test   Query ", includeDomains: ["b.com", "a.com"] };
    expect(webResearchCacheKey(base)).toBe(webResearchCacheKey({ ...base, query: "test query", includeDomains: ["a.com", "b.com"] }));
  });

  it("classifies failures for deterministic fallback telemetry", () => {
    expect(classifyWebResearchError(new Error("429 quota exceeded"))).toBe("rate_limit");
    expect(classifyWebResearchError(new Error("request timeout"))).toBe("timeout");
    expect(classifyWebResearchError(new Error("invalid JSON schema"))).toBe("invalid_structured_output");
  });
});

describe("context budgets", () => {
  it("truncates at the configured source boundary", () => {
    const source: Source = { id: "s", canonicalUrl: "https://example.com", title: "Title", publisher: "Example", publishedAt: null, retrievedAt: now, excerpt: "word ".repeat(1_000), type: "web" };
    expect(compactSources([source])[0].excerpt.length).toBeLessThanOrEqual(800);
    expect(truncateText("word ".repeat(1_000), 100).length).toBeLessThanOrEqual(100);
  });

  it("rejects model input above 16K estimated tokens", () => {
    expect(estimateTokens("x".repeat(MODEL_INPUT_TOKEN_LIMIT * 4))).toBe(MODEL_INPUT_TOKEN_LIMIT);
    expect(() => assertModelInputBudget({ prompt: "x".repeat(MODEL_INPUT_TOKEN_LIMIT * 4 + 1) })).toThrow(/16,000-token budget/);
  });
});
