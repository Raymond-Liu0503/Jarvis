import { generateText } from "ai";
import { z } from "zod";
import type { ResearchPlan } from "@/lib/contracts";
import { modelProvider, STRUCTURED_GENERATION_SETTINGS } from "@/lib/providers/model";
import { getSkill, loadSkills, skillCatalog } from "@/lib/skills/loader";
import { MODEL_CALL_TIMEOUT_MS } from "@/lib/research/limits";
import { requireObjectFromText } from "@/lib/research/structured-output";

const routeSchema = z.object({
  selections: z.array(z.object({
    skillId: z.string(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
  })).max(3),
  clarification: z.string().nullable(),
});

export type SkillRoute = z.infer<typeof routeSchema> & { fallback?: boolean };

const jsonInstruction = (schema: z.ZodType) => `Return exactly one JSON object and no other text. It must match this JSON Schema: ${JSON.stringify(z.toJSONSchema(schema))}`;

const securitiesPattern = /\b(stock|stocks|ticker|shares?|earnings|filings?|valuation|portfolio|dividend|market cap|p\/e|public company|nasdaq|nyse)\b/i;
const explicitProductPattern = /\b(product|shopping|headphones?|laptops?|cameras?|televisions?|phones?|appliances?|shoes?|mattress(?:es)?|specifications?|compatibility)\b/i;
const productIntentPattern = /\b(buy|price|compare|review)\b/i;

function isSecuritiesOnlyQuery(query: string) {
  return securitiesPattern.test(query) && !explicitProductPattern.test(query);
}

export function heuristicRoute(query: string): SkillRoute {
  const selections: SkillRoute["selections"] = [];
  if (securitiesPattern.test(query)) selections.push({ skillId: "stock-analysis", confidence: .82, rationale: "Public markets or company analysis." });
  if (/\b(trip|travel|flight|hotel|destination|itinerary|vacation|weather)\b/i.test(query)) selections.push({ skillId: "travel-planning", confidence: .82, rationale: "Travel planning or logistics." });
  if (explicitProductPattern.test(query) || (!isSecuritiesOnlyQuery(query) && (productIntentPattern.test(query) || /https?:\/\//i.test(query)))) {
    selections.push({ skillId: "product-research", confidence: .76, rationale: "Product evaluation or purchase research." });
  }
  return {
    selections: selections.length ? selections.slice(0, 3) : [{ skillId: "general-research", confidence: .7, rationale: "No specialized skill clearly owns the request." }],
    clarification: null,
    fallback: true,
  };
}

export async function routeSkills(query: string, history: Array<{ role: string; content: string }> = []): Promise<SkillRoute> {
  if (!modelProvider.configured("FAST")) return heuristicRoute(query);
  try {
    const result = await generateText({
      model: modelProvider.model("FAST"),
      system: `Route to up to three installed research skills. Select every genuinely required domain. Use general-research only when no specialized skill applies and never combine it. Buying or pricing a stock is stock analysis, not product research. Ask one clarification only when interpretations are genuinely ambiguous and confidence is below 0.70. Give concise decision rationale, not hidden reasoning.\n${jsonInstruction(routeSchema)}`,
      prompt: `Skills:\n${JSON.stringify(skillCatalog())}\nConversation:\n${JSON.stringify(history)}\nLatest request: ${query}`,
      ...STRUCTURED_GENERATION_SETTINGS,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    });
    const output = requireObjectFromText(result.text, routeSchema);
    let valid = output.selections.filter(item => loadSkills().has(item.skillId));
    if (isSecuritiesOnlyQuery(query)) valid = valid.filter(item => item.skillId !== "product-research");
    if (valid.some(item => item.skillId !== "general-research")) valid = valid.filter(item => item.skillId !== "general-research");
    valid = [...new Map(valid.map(item => [item.skillId, item])).values()].slice(0, 3);
    return valid.length ? { ...output, selections: valid } : heuristicRoute(query);
  } catch {
    return heuristicRoute(query);
  }
}

const planSchema = z.object({
  missing: z.array(z.object({ skillId: z.string(), fieldId: z.string() })).max(3),
  lensIds: z.array(z.string()).max(4),
  rationale: z.string(),
});

export async function planResearch(skillIds: string[], query: string, history: Array<{ role: string; content: string }>): Promise<{ plan?: ResearchPlan; questions?: string[] }> {
  const skills = skillIds.map(getSkill);
  const all = skills.flatMap(skill => skill.specialists);
  const fallback = (): ResearchPlan => {
    const selected = skills.flatMap(skill => skill.specialists.slice(0, 1));
    for (const lens of all) {
      if (selected.length < Math.min(4, Math.max(3, all.length)) && !selected.some(item => item.id === lens.id)) selected.push(lens);
    }
    return {
      skillIds,
      skillVersions: Object.fromEntries(skills.map(skill => [skill.id, skill.version])),
      specialists: selected.slice(0, 4).map(({ id, skillId, label, focus }) => ({ id, skillId, label, focus })),
      rationale: "Deterministic balanced specialist plan.",
      fallback: true,
    };
  };
  if (!modelProvider.configured("REASONING")) return { plan: fallback() };
  try {
    const result = await generateText({
      model: modelProvider.model("REASONING"),
      system: `Validate required intake and select 3 or 4 relevant lenses total, including at least one from each skill. Return only listed IDs and one concise rationale.\n${jsonInstruction(planSchema)}`,
      prompt: `Request: ${query}\nContext: ${JSON.stringify(history)}\nSkills: ${JSON.stringify(skills.map(skill => ({ id: skill.id, intake: skill.intake, lenses: skill.specialists.map(lens => ({ id: lens.id, mission: lens.mission })) })))}`,
      ...STRUCTURED_GENERATION_SETTINGS,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    });
    const output = requireObjectFromText(result.text, planSchema);
    if (output.missing.length) {
      const questions = output.missing.flatMap(item => {
        const field = getSkill(item.skillId).intake.find(candidate => candidate.id === item.fieldId);
        return field ? [field.question] : [];
      });
      if (questions.length) return { questions: [...new Set(questions)].slice(0, 3) };
    }
    const chosen = output.lensIds.flatMap(id => {
      const lens = all.find(item => item.id === id);
      return lens ? [lens] : [];
    });
    if (chosen.length < 3 || chosen.length > 4 || !skills.every(skill => chosen.some(lens => lens.skillId === skill.id))) return { plan: fallback() };
    return {
      plan: {
        skillIds,
        skillVersions: Object.fromEntries(skills.map(skill => [skill.id, skill.version])),
        specialists: chosen.map(({ id, skillId, label, focus }) => ({ id, skillId, label, focus })),
        rationale: output.rationale,
      },
    };
  } catch {
    return { plan: fallback() };
  }
}
