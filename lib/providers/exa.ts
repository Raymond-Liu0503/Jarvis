import type { Source } from "@/lib/contracts";
import type { ProviderResult, SearchOptions, SearchProvider } from "@/lib/providers/contracts";

type ExaResult = { id?: string; title?: string; url: string; publishedDate?: string; author?: string; highlights?: string[]; highlightScores?: number[]; text?: string };
export type ExaSearchCandidate = { id: string; title: string; url: string; excerpt: string; publishedAt: string | null; retrievedAt: string; rank: number; highlightScore?: number };

export const excerptFromExaResult = (result: Pick<ExaResult, "highlights" | "text">) => (result.highlights ?? []).join(" ").slice(0, 800) || result.text?.slice(0, 800) || "";

/** Server-side Exa adapter. Returned web content is untrusted evidence. */
export class ExaSearchProvider implements SearchProvider {
  constructor(private readonly apiKey = process.env.EXA_API_KEY) {}

  async searchCandidates(query: string, input: SearchOptions = {}): Promise<ExaSearchCandidate[]> {
    if (!this.apiKey) throw new Error("EXA_API_KEY is not configured");
    const options = input;
    const limit = options.limit ?? 10;
    const retrievedAt = new Date();
    const timeout = AbortSignal.timeout(15_000);
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({ query, type: "auto", numResults: Math.min(Math.max(limit, 1), 10), category: options.category, includeDomains: options.includeDomains, excludeDomains: options.excludeDomains, startPublishedDate: options.startPublishedDate, endPublishedDate: options.endPublishedDate, contents: { highlights: { query: options.highlightQuery ?? query, maxCharacters: 800 }, maxAgeHours: options.maxAgeHours } }),
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`Exa search failed (${response.status})`);
    const payload = await response.json() as { results?: ExaResult[] };
    return (payload.results ?? []).map((result, rank) => ({ id: `exa-${result.id ?? rank}`, title: result.title ?? result.url, url: result.url, excerpt: excerptFromExaResult(result), publishedAt: result.publishedDate ?? null, retrievedAt: retrievedAt.toISOString(), rank, highlightScore: result.highlightScores?.length ? Math.max(...result.highlightScores) : undefined }));
  }

  async search(query: string, input: number | SearchOptions = {}): Promise<ProviderResult<Array<{ title: string; url: string; excerpt: string }>>> {
    const options = typeof input === "number" ? { limit: input } : input;
    const candidates = await this.searchCandidates(query, options);
    const retrievedAt = new Date();
    const data = candidates.map(result => ({ title: result.title, url: result.url, excerpt: result.excerpt }));
    const sources: Source[] = candidates.map(result => ({
      id: result.id, canonicalUrl: result.url, title: result.title, publisher: new URL(result.url).hostname,
      publishedAt: result.publishedAt, retrievedAt: result.retrievedAt, excerpt: result.excerpt, type: "web",
    }));
    return { data, sources, provider: "exa", retrievedAt: retrievedAt.toISOString(), expiresAt: new Date(retrievedAt.getTime() + 6 * 60 * 60_000).toISOString() };
  }
}

export const exaSearchProvider = new ExaSearchProvider();
