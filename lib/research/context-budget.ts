import type { Source, SpecialistResult } from "@/lib/contracts";

export const MODEL_INPUT_TOKEN_LIMIT = 16_000;
export const MODEL_INPUT_CHAR_LIMIT = MODEL_INPUT_TOKEN_LIMIT * 4;
export const WEB_RERANK_TOKEN_LIMIT = 4_000;
export const SOURCE_EXCERPT_CHAR_LIMIT = 800;
export const SYNTHESIS_EXCERPT_CHAR_LIMIT = 500;

export function estimateTokens(value: string) {
  return Math.ceil(value.length / 4);
}

export function truncateText(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  const slice = normalized.slice(0, Math.max(0, maximum - 1));
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf(" "));
  return `${slice.slice(0, boundary > maximum * 0.6 ? boundary + 1 : slice.length).trimEnd()}…`;
}

export function compactSources(sources: Source[], maximum = 10, excerptLimit = SOURCE_EXCERPT_CHAR_LIMIT) {
  return sources.slice(0, maximum).map(source => ({
    id: source.id,
    title: truncateText(source.title, 240),
    publisher: truncateText(source.publisher, 120),
    publishedAt: source.publishedAt,
    retrievedAt: source.retrievedAt,
    canonicalUrl: source.canonicalUrl,
    excerpt: truncateText(source.excerpt, excerptLimit),
  }));
}

export function compactSpecialistResults(results: SpecialistResult[]) {
  return results.map(result => ({
    specialist: result.specialist,
    summary: truncateText(result.summary, 800),
    findings: result.findings.slice(0, 8).map(finding => ({
      specialist: finding.specialist,
      claim: truncateText(finding.claim, 400),
      confidence: finding.confidence,
      sourceIds: finding.sourceIds,
      caveats: finding.caveats.slice(0, 3).map(caveat => truncateText(caveat, 240)),
    })),
    limitations: result.limitations.slice(0, 4).map(item => truncateText(item, 300)),
  }));
}

export function assertModelInputBudget(parts: Record<string, string>, limit = MODEL_INPUT_TOKEN_LIMIT) {
  const counts = Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, estimateTokens(value)]));
  const estimatedTokens = Object.values(counts).reduce((total, count) => total + count, 0);
  if (estimatedTokens > limit) throw new Error(`Model input exceeds the ${limit.toLocaleString("en-US")}-token budget (${estimatedTokens} estimated tokens)`);
  return { estimatedTokens, sectionTokens: counts };
}

const SECRET_PATTERN = /(?:sk-or-v1-|Bearer\s+)[A-Za-z0-9._-]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;

export function logModelInput(operation: string, parts: Record<string, string>) {
  const budget = assertModelInputBudget(parts);
  console.info("[model-input]", { operation, ...budget, characters: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, value.length])) });
  if (process.env.NODE_ENV !== "production" && process.env.RESEARCH_DEBUG_PAYLOADS === "redacted") {
    console.debug("[model-input-preview]", operation, Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, truncateText(value.replace(SECRET_PATTERN, "[REDACTED]"), 500)])));
  }
  return budget;
}
