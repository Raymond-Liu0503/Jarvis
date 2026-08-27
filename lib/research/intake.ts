import type { ResearchMode } from "@/lib/contracts";

const patterns: Record<ResearchMode, Array<{ field: string; test: RegExp }>> = {
  stocks: [{ field: "ticker or company", test: /\b[A-Z]{1,5}\b|apple|microsoft|nvidia|tesla|amazon|alphabet/i }],
  travel: [{ field: "destination", test: /\b(?:to|in|visit|trip)\s+[A-Za-z]{3,}/i }, { field: "dates", test: /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|\b20\d{2}\b|\b\d{1,2}[/-]\d{1,2}/i }],
  shopping: [{ field: "product or public URL", test: /https?:\/\/|\b(?:buy|compare|product|laptop|camera|chair|headphones|phone|shoe)\b/i }],
};
export function validateIntake(mode: ResearchMode, query: string) {
  const missing = patterns[mode].filter(item => !item.test.test(query)).map(item => item.field);
  return { complete: missing.length === 0, missing, questions: missing.map(field => `What ${field} should I use?`) };
}

export function classifyHub(query: string): { mode: ResearchMode | null; confidence: number } {
  const scores: Record<ResearchMode, number> = { stocks: 0, travel: 0, shopping: 0 };
  if (/stock|ticker|shares?|earnings|filing|market|portfolio|\b[A-Z]{2,5}\b/.test(query)) scores.stocks += .82;
  if (/trip|travel|flight|hotel|destination|itinerary|vacation/.test(query.toLowerCase())) scores.travel += .82;
  if (/buy|price|product|shopping|compare|review|https?:\/\//.test(query.toLowerCase())) scores.shopping += .76;
  const [mode, confidence] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] as [ResearchMode, number];
  return confidence >= .7 ? { mode, confidence } : { mode: null, confidence };
}
