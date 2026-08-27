import type { Source } from "@/lib/contracts";
import type { ProviderResult, SearchOptions, SearchProvider } from "@/lib/providers/contracts";

type ExaResult = { id?: string; title?: string; url: string; publishedDate?: string; author?: string; highlights?: string[]; text?: string };

/** Server-side Exa adapter. Returned web content is untrusted evidence. */
export class ExaSearchProvider implements SearchProvider {
  private readonly apiKey = process.env.EXA_API_KEY;

  async search(query: string, input: number | SearchOptions = {}): Promise<ProviderResult<Array<{ title: string; url: string; excerpt: string }>>> {
    if (!this.apiKey) throw new Error("EXA_API_KEY is not configured");
    const options = typeof input === "number" ? { limit: input } : input;
    const limit = options.limit ?? 10;
    const retrievedAt = new Date();
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({ query, type: "auto", numResults: Math.min(Math.max(limit, 1), 100), category: options.category, includeDomains: options.includeDomains, excludeDomains: options.excludeDomains, startPublishedDate: options.startPublishedDate, endPublishedDate: options.endPublishedDate, contents: { highlights: true, maxAgeHours: options.maxAgeHours } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Exa search failed (${response.status})`);
    const payload = await response.json() as { results?: ExaResult[] };
    const data = (payload.results ?? []).map(result => ({ title: result.title ?? result.url, url: result.url, excerpt: result.highlights?.join(" ") ?? result.text?.slice(0, 800) ?? "" }));
    const sources: Source[] = data.map((result, index) => ({
      id: `exa-${payload.results?.[index]?.id ?? index}`, canonicalUrl: result.url, title: result.title, publisher: new URL(result.url).hostname,
      publishedAt: payload.results?.[index]?.publishedDate ?? null, retrievedAt: retrievedAt.toISOString(), excerpt: result.excerpt, type: "web",
    }));
    return { data, sources, provider: "exa", retrievedAt: retrievedAt.toISOString(), expiresAt: new Date(retrievedAt.getTime() + 6 * 60 * 60_000).toISOString() };
  }
}

export const exaSearchProvider = new ExaSearchProvider();
