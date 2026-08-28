import type { Source } from "@/lib/contracts";

export function quickEvidenceFallback(sources: Source[]) {
  const usable = sources.filter(source => source.excerpt.trim()).slice(0, 4);
  if (!usable.length) return undefined;
  return [
    "The response model did not complete its synthesis, but I retrieved the following source-grounded evidence:",
    ...usable.map(source => `- ${source.excerpt.trim().slice(0, 420)} [${source.id}]`),
    "\nThis is a degraded evidence summary; review the linked sources before relying on it.",
  ].join("\n");
}
