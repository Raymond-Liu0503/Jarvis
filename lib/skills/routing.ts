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
const productIntentPattern = /\b(buy|price|review)\b/i;

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

export const CLARIFICATION_SOFT_LIMIT = 5;

export function clarificationPlanningGuidance(clarificationRounds: number) {
  if (clarificationRounds < CLARIFICATION_SOFT_LIMIT) return "";
  return ` ${clarificationRounds} clarification rounds have already been completed. Prefer proceeding with explicit reasonable assumptions. Ask again only when the missing detail is genuinely necessary for safety or feasibility; this is a soft threshold, not a hard limit.`;
}

export function hasExplicitIntakeValue(skillId: string, fieldId: string, query: string) {
  if (skillId === "stock-analysis" && fieldId === "company") {
    if (/\$[A-Z]{1,5}\b|\b[A-Z]{2,5}\b/.test(query)) return true;
    const stopwords = new Set(["this", "that", "which", "what", "some", "good", "public", "company", "stock", "share", "shares"]);
    const candidates = [
      query.match(/\b([a-z][a-z0-9.&-]{2,})\s+(?:stock|shares?)\b/i)?.[1],
      query.match(/\b(?:buy|research|analy[sz]e|evaluate|about|is)\s+([a-z][a-z0-9.&-]{2,})\b/i)?.[1],
    ];
    return candidates.some(candidate => candidate && !stopwords.has(candidate.toLowerCase()));
  }
  if (skillId === "product-research" && fieldId === "product") return explicitProductPattern.test(query) || /https?:\/\//i.test(query) || /\bcompare\s+\S+\s+(?:and|vs\.?|versus)\s+\S+/i.test(query);
  if (skillId === "product-research" && fieldId === "requirements") return /\b(?:budget|under|maximum|at most|for (?:my|a|an|the)|must|need|require|compatible|fit|size|feature|priority|prefer|use case|warranty)\b|[$€£]\s?\d/i.test(query);
  if (skillId === "travel-planning" && fieldId === "destination") return /\b(?:to|in|visit|around|destination)\s+[A-Z][\p{L}.' -]{1,40}/u.test(query);
  if (skillId === "travel-planning" && fieldId === "dates") return /\b(?:20\d{2}-\d{1,2}-\d{1,2}|today|tomorrow|next\s+\w+|this\s+\w+|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(query);
  if (skillId === "travel-planning" && fieldId === "origin") return /\b(?:from|departing|leaving|flying out of|based in)\s+[A-Z][\p{L}.' -]{1,40}/u.test(query);
  if (skillId === "travel-planning" && fieldId === "traveller-constraints") return /\b(?:passport|citizen|nationality|visa|wheelchair|accessible|mobility|allerg|diet|child|children|infant|senior|medical|travell?ers?|passengers?)\b/i.test(query);
  return false;
}

export async function planResearch(skillIds: string[], query: string, history: Array<{ role: string; content: string }>, clarificationRounds = 0): Promise<{ plan?: ResearchPlan; questions?: string[] }> {
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
      system: `Validate intake and select 3 or 4 relevant lenses total, including at least one from each skill. Treat each intake field's requiredWhen as conditional: mark it missing only when its absence would materially change feasibility, safety, or the recommendation. Otherwise proceed and state a reasonable assumption in the plan rationale. A ticker or explicitly named public company satisfies stock-analysis.company.${clarificationPlanningGuidance(clarificationRounds)} Return only listed IDs and one concise rationale.\n${jsonInstruction(planSchema)}`,
      prompt: `Request: ${query}\nContext: ${JSON.stringify(history)}\nSkills: ${JSON.stringify(skills.map(skill => ({ id: skill.id, intake: skill.intake, lenses: skill.specialists.map(lens => ({ id: lens.id, mission: lens.mission })) })))}`,
      ...STRUCTURED_GENERATION_SETTINGS,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    });
    const output = requireObjectFromText(result.text, planSchema);
    const intakeContext = `${history.map(item => item.content).join(" ")} ${query}`;
    const genuinelyMissing = output.missing.filter(item => !hasExplicitIntakeValue(item.skillId, item.fieldId, intakeContext));
    if (genuinelyMissing.length) {
      const questions = genuinelyMissing.flatMap(item => {
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
