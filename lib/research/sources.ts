import type { Finding, Source } from "@/lib/contracts";

export function canonicalizeUrl(value: string) {
  const url = new URL(value); url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(ref|affiliate|aff)$/i.test(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase(); return url.toString().replace(/\/$/, "");
}
export function deduplicateSources(sources: Source[]) {
  const found = new Map<string, Source>();
  for (const source of sources) { const key = canonicalizeUrl(source.canonicalUrl); if (!found.has(key)) found.set(key, { ...source, canonicalUrl: key }); }
  return [...found.values()];
}
export function hasCitationCoverage(findings: Finding[], sources: Source[]) {
  const ids = new Set(sources.map(source => source.id));
  return findings.every(finding => finding.sourceIds.length > 0 && finding.sourceIds.every(id => ids.has(id)));
}
