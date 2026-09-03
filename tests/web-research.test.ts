import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { ExaSearchProvider, excerptFromExaResult, exaSearchProvider, type ExaSearchCandidate } from "@/lib/providers/exa";
import { assertModelInputBudget, compactSources, estimateTokens, MODEL_INPUT_TOKEN_LIMIT, truncateText } from "@/lib/research/context-budget";
import { classifyWebResearchError, isWebRerankingEnabled, rankWebCandidates, runWebResearch, webResearchCacheKey } from "@/lib/research/web-research";
import type { Source } from "@/lib/contracts";

const now = "2026-08-28T12:00:00.000Z";
const candidate = (id: string, url: string, rank: number, excerpt = "useful evidence"): ExaSearchCandidate => ({ id, url, rank, excerpt, title: `Source ${id}`, publishedAt: now, retrievedAt: now, highlightScore: .8 });

const mockedQuery = vi.mocked(query);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockedQuery.mockReset();
});

describe("bounded web research", () => {
  it("caps Exa highlight arrays before they enter research context", () => {
    expect(excerptFromExaResult({ highlights: ["x".repeat(2_000)] })).toHaveLength(800);
  });

  it("requests ten candidates with objective-aware 800-character highlights and no query variants", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await new ExaSearchProvider("test-key").searchCandidates("base query", { limit: 30, highlightQuery: "decision objective" });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ query: "base query", type: "auto", numResults: 10, contents: { highlights: { query: "decision objective", maxCharacters: 800 } } });
    expect(body).not.toHaveProperty("additionalQueries");
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

  it("uses one ten-candidate pass when minimum evidence is sufficient", async () => {
    const candidates = Array.from({ length: 14 }, (_, index) => candidate(String(index), `https://source${index}.example/article`, index, "z".repeat(2_000)));
    const search = vi.spyOn(exaSearchProvider, "searchCandidates").mockResolvedValue(candidates);
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousDatabase = process.env.DATABASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DATABASE_URL;
    try {
      const result = await runWebResearch({ userId: "00000000-0000-0000-0000-000000000001", query: "bounded test query", limit: 10 });
      expect(search).toHaveBeenCalledTimes(1);
      expect(search.mock.calls[0][1]).toMatchObject({ limit: 10, highlightQuery: "bounded test query" });
      expect(result.results).toHaveLength(10);
      expect(result).toMatchObject({ candidateLimit: 10, searchPasses: 1, minimumResults: 2, stopReason: "minimum_met" });
      expect(result.results.every(source => source.excerpt.length <= 800)).toBe(true);
      expect(result.reranked).toBe(false);
    } finally {
      if (previousKey) process.env.OPENROUTER_API_KEY = previousKey;
      if (previousDatabase) process.env.DATABASE_URL = previousDatabase;
    }
  });

  it("defaults ordinary Quick Search output to four sources", async () => {
    const candidates = Array.from({ length: 10 }, (_, index) => candidate(String(index), `https://quick${index}.example/article`, index));
    vi.spyOn(exaSearchProvider, "searchCandidates").mockResolvedValue(candidates);
    const previousDatabase = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const result = await runWebResearch({ userId: "u", query: "ordinary quick search" });
      expect(result.results).toHaveLength(4);
    } finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
    }
  });

  it("makes one narrow expansion only when deduplication misses minimumResults", async () => {
    const search = vi.spyOn(exaSearchProvider, "searchCandidates")
      .mockResolvedValueOnce([candidate("a", "https://first.example/article", 0)])
      .mockResolvedValueOnce([
        candidate("b", "https://agency.gov/report", 0),
        candidate("c", "https://second.example/report", 1),
      ]);
    const previousDatabase = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const result = await runWebResearch({ userId: "u", query: "thin evidence", objective: "verify the material claim", limit: 4, minimumResults: 2 });
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[1][0]).toMatch(/official primary authoritative evidence/);
      expect(result.results).toHaveLength(3);
      expect(result).toMatchObject({ searchPasses: 2, stopReason: "expanded_minimum_met", candidateCount: 3 });
    } finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
    }
  });

  it("preserves partial first-pass evidence when the one expansion fails", async () => {
    vi.spyOn(exaSearchProvider, "searchCandidates")
      .mockResolvedValueOnce([candidate("a", "https://first.example/article", 0)])
      .mockRejectedValueOnce(new Error("503 provider unavailable"));
    const previousDatabase = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const result = await runWebResearch({ userId: "u", query: "partial evidence", limit: 4, minimumResults: 2 });
      expect(result.results.map(source => source.id)).toEqual(["a"]);
      expect(result).toMatchObject({ searchPasses: 2, stopReason: "expansion_failed" });
      expect(result.limitation).toMatch(/partial first-pass evidence/i);
    } finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
    }
  });

  it("caches ten ranked results independently of caller slicing", async () => {
    const candidates = Array.from({ length: 10 }, (_, index) => candidate(String(index), `https://source${index}.example/article`, index));
    const search = vi.spyOn(exaSearchProvider, "searchCandidates").mockResolvedValue(candidates);
    let cachedResults: unknown[] | undefined;
    mockedQuery.mockImplementation(async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith("select")) return { rows: cachedResults ? [{ results: cachedResults, candidate_count: 10, expires_at: "2099-01-01T00:00:00.000Z" }] : [] } as never;
      cachedResults = JSON.parse(String(parameters?.[4]));
      return { rows: [] } as never;
    });
    const previousDatabase = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://cache-test";
    try {
      const first = await runWebResearch({ userId: "u", query: "cache slicing", limit: 4 });
      const second = await runWebResearch({ userId: "u", query: "cache slicing", limit: 2 });
      expect(first.results).toHaveLength(4);
      expect(cachedResults).toHaveLength(10);
      expect(second.results).toHaveLength(2);
      expect(second).toMatchObject({ cacheHit: true, searchPasses: 0, stopReason: "cache_hit" });
      expect(search).toHaveBeenCalledTimes(1);
    } finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
    }
  });

  it("bypasses a cache entry that cannot satisfy minimumResults", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ results: [{ id: "cached" }], candidate_count: 1, expires_at: "2099-01-01T00:00:00.000Z" }] } as never).mockResolvedValue({ rows: [] } as never);
    const search = vi.spyOn(exaSearchProvider, "searchCandidates").mockResolvedValue([
      candidate("a", "https://first.example/article", 0),
      candidate("b", "https://second.example/article", 1),
    ]);
    const previousDatabase = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://cache-test";
    try {
      const result = await runWebResearch({ userId: "u", query: "undersized cache", limit: 4, minimumResults: 2 });
      expect(result.cacheHit).toBe(false);
      expect(search).toHaveBeenCalledTimes(1);
    } finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
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

  it("enables model reranking only with an explicit true flag", () => {
    const previous = process.env.WEB_RESEARCH_RERANK_ENABLED;
    try {
      delete process.env.WEB_RESEARCH_RERANK_ENABLED;
      expect(isWebRerankingEnabled()).toBe(false);
      process.env.WEB_RESEARCH_RERANK_ENABLED = "true";
      expect(isWebRerankingEnabled()).toBe(true);
      process.env.WEB_RESEARCH_RERANK_ENABLED = "false";
      expect(isWebRerankingEnabled()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.WEB_RESEARCH_RERANK_ENABLED;
      else process.env.WEB_RESEARCH_RERANK_ENABLED = previous;
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
