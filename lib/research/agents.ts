import { generateText } from "ai";
import { z } from "zod";
import type { Finding, ResearchReport, Source, SpecialistDefinition, SpecialistResult } from "@/lib/contracts";
import { findingSchema } from "@/lib/contracts";
import { modelProvider, STRUCTURED_GENERATION_SETTINGS } from "@/lib/providers/model";
import { EvidenceStore, ToolCallBudget } from "@/lib/research/evidence";
import { collectWebEvidence, createResearchTools, type ResearchToolContext, type ToolProgress } from "@/lib/research/tools";
import { hasCitationCoverage } from "@/lib/research/sources";
import { RESEARCH_CORE_PROMPT } from "@/lib/research/core";
import { MODEL_CALL_TIMEOUT_MS, SYNTHESIS_TIMEOUT_MS } from "@/lib/research/limits";
import { requireObjectFromText } from "@/lib/research/structured-output";

const synthesisSchema = z.object({ title: z.string(), executiveAnswer: z.string(), recommendations: z.array(z.string()), alternatives: z.array(z.string()), tradeoffs: z.array(z.string()), risks: z.array(z.string()), assumptions: z.array(z.string()) });
const evidencePrompt = (sources: Source[]) => sources.map(source => `[${source.id}] ${source.title} — ${source.publisher}\n${source.excerpt}\n${source.canonicalUrl}`).join("\n\n");
const jsonInstruction = (schema: z.ZodType) => `Return exactly one JSON object and no other text. It must match this JSON Schema: ${JSON.stringify(z.toJSONSchema(schema))}`;
function verifiedResult(definition: SpecialistDefinition, result: SpecialistResult, sources: Source[]) { const ids = new Set(sources.map(source => source.id)); const findings = result.findings.filter(finding => finding.sourceIds.length > 0 && finding.sourceIds.every(id => ids.has(id))).map(finding => ({ ...finding, specialist: definition.id })); if (!findings.length || new Set(findings.flatMap(finding => finding.sourceIds)).size < definition.evidencePolicy.minimumSources) throw new Error(`${definition.label} did not meet its evidence threshold`); return { ...result, specialist: definition.id, findings }; }

function specialistOutputSchema(definition: SpecialistDefinition, sources: Source[]) {
  const [firstSourceId, ...otherSourceIds] = sources.map(source => source.id);
  if (!firstSourceId) throw new Error(`${definition.label} has no source IDs for structured analysis`);
  const sourceIdSchema = z.enum([firstSourceId, ...otherSourceIds]);
  const constrainedFindingSchema = z.object({
    specialist: z.literal(definition.id),
    claim: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sourceIds: z.array(sourceIdSchema).min(1),
    caveats: z.array(z.string()),
  });
  return z.object({
    specialist: z.literal(definition.id),
    summary: z.string().min(1),
    findings: z.array(constrainedFindingSchema).min(1),
    limitations: z.array(z.string()).default([]),
  });
}

export function searchOptionsFor(definition: SpecialistDefinition, now = new Date()) {
  const freshness = definition.evidencePolicy.freshness;
  if (!freshness) return {};
  const startPublishedDate = freshness.publishedWithinDays
    ? new Date(now.getTime() - freshness.publishedWithinDays * 24 * 60 * 60_000).toISOString()
    : undefined;
  return {
    category: freshness.category,
    startPublishedDate,
    endPublishedDate: startPublishedDate ? now.toISOString() : undefined,
    maxAgeHours: freshness.maxAgeHours,
  };
}

export function fallbackSpecialistResult(definition: SpecialistDefinition, sources: Source[], summary?: string): SpecialistResult {
  const usable = sources.filter(source => source.excerpt.trim()).slice(0, Math.max(definition.evidencePolicy.minimumSources, 3));
  if (usable.length < definition.evidencePolicy.minimumSources) throw new Error(`${definition.label} could not recover enough evidence after malformed model output`);
  return { specialist: definition.id, summary: summary?.trim() || `${definition.label} retrieved ${usable.length} sources, but the reasoning model returned malformed structured output. The report can use the evidence excerpts below with reduced confidence.`, findings: usable.map(source => ({ specialist: definition.id, claim: source.excerpt.trim().slice(0, 600), confidence: .35, sourceIds: [source.id], caveats: ["Degraded evidence-only finding: the reasoning model's structured output could not be validated."] })), limitations: [summary ? "Degraded structured output; a source-cited plain-text analysis was preserved." : "Degraded structured output; findings preserve retrieved source excerpts rather than model synthesis."] };
}

export async function runSpecialist(input: { definition: SpecialistDefinition; query: string; evidence: EvidenceStore; onProgress?: ToolProgress }): Promise<SpecialistResult> {
  const { definition, query, evidence, onProgress } = input;
  await onProgress?.("planning", definition.mission);

  const context: ResearchToolContext = {
    evidence,
    calls: new ToolCallBudget(definition.maxToolRounds),
    onProgress,
  };
  const { tools, unavailable } = createResearchTools(definition.tools, context);
  if (!tools.webSearch) throw new Error(`${definition.label} requires the configured web-search provider`);

  const shape = `Return an object with exactly this shape: {"specialist":"${definition.id}","summary":"string","findings":[{"specialist":"${definition.id}","claim":"one atomic claim","confidence":0.0,"sourceIds":["source-id"],"caveats":["string"]}],"limitations":["string"]}. Never return Markdown, a title/source/url citation card, or source URLs in place of sourceIds.`;
  let collectionError: unknown;
  const searchAngles = [definition.focus, definition.mission, `${definition.label} primary sources independent evidence`];
  const freshnessOptions = searchOptionsFor(definition);
  for (let round = 0; round < definition.maxToolRounds && evidence.all().length < definition.evidencePolicy.minimumSources; round += 1) {
    const searchQuery = `${query.slice(0, 350)} ${searchAngles[round % searchAngles.length]}`.trim().slice(0, 500);
    try {
      await collectWebEvidence({ query: searchQuery, limit: 5, ...freshnessOptions }, context);
    } catch (error) {
      collectionError = error;
    }
  }

  const sources = evidence.all();
  if (sources.length < definition.evidencePolicy.minimumSources) {
    if (collectionError instanceof Error) throw collectionError;
    throw new Error(`${definition.label} retrieved ${sources.length} of ${definition.evidencePolicy.minimumSources} required sources`);
  }

  await onProgress?.("analyzing", `${definition.label} is evaluating evidence`);
  const outputSchema = specialistOutputSchema(definition, sources);
  const sourceIds = sources.map(source => source.id);
  const analysisSystem = `${RESEARCH_CORE_PROMPT}\n\n${definition.systemPrompt}\nUse only the supplied evidence. Every sourceIds value must be selected verbatim from this list: ${JSON.stringify(sourceIds)}. Use at least ${definition.evidencePolicy.minimumSources} unique IDs across findings. Unavailable tools during collection: ${unavailable.join(", ") || "none"}. ${shape}\n${jsonInstruction(outputSchema)}`;
  try {
    const result = await generateText({
      model: modelProvider.model("REASONING"),
      system: analysisSystem,
      prompt: `Specialist: ${definition.id}\nMission: ${definition.mission}\nRequest: ${query}\nEvidence:\n${evidencePrompt(sources)}`,
      ...STRUCTURED_GENERATION_SETTINGS,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    });
    return verifiedResult(definition, requireObjectFromText(result.text, outputSchema), sources);
  } catch {
    try {
      const repair = await generateText({ model: modelProvider.model("REASONING"), system: `${RESEARCH_CORE_PROMPT}\nYou are repairing invalid structured output. Use only supplied evidence. Valid source IDs: ${JSON.stringify(sourceIds)}. ${shape}\n${jsonInstruction(outputSchema)}`, prompt: `Specialist: ${definition.id}\nMission: ${definition.mission}\nRequest: ${query}\nEvidence:\n${evidencePrompt(sources)}`, ...STRUCTURED_GENERATION_SETTINGS, maxRetries: 0, abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS) });
      return verifiedResult(definition, requireObjectFromText(repair.text, outputSchema), sources);
    } catch {
      try {
        const plain = await generateText({
          model: modelProvider.model("REASONING"),
          system: `${RESEARCH_CORE_PROMPT}\n${definition.systemPrompt}\nWrite a concise plain-text analysis using only supplied evidence. Cite factual claims with bracketed source IDs selected verbatim from ${JSON.stringify(sourceIds)}. Do not output JSON.`,
          prompt: `Request: ${query}\nMission: ${definition.mission}\nEvidence:\n${evidencePrompt(sources)}`,
          temperature: 0.2,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
        });
        const citedCount = sources.filter(source => plain.text.includes(`[${source.id}]`)).length;
        return fallbackSpecialistResult(definition, sources, citedCount >= definition.evidencePolicy.minimumSources ? plain.text : undefined);
      } catch { return fallbackSpecialistResult(definition, sources); }
    }
  }
}

export async function synthesizeReport(input: { runId: string; skillIds: string[]; query: string; specialistResults: SpecialistResult[]; sources: Source[]; skillPrompts: string[] }): Promise<ResearchReport> {
  const findings = input.specialistResults.flatMap(result => result.findings); if (!hasCitationCoverage(findings, input.sources)) throw new Error("Cannot synthesize a report with invalid citation coverage");
  try { const result = await generateText({ model: modelProvider.model("SYNTHESIS"), system: `${RESEARCH_CORE_PROMPT}\n${input.skillPrompts.join("\n\n")}\nUse only supplied findings and preserve disagreements and limitations. Return the requested structured report object, never Markdown.\n${jsonInstruction(synthesisSchema)}`, prompt: `Question: ${input.query}\nVerified results:\n${JSON.stringify(input.specialistResults)}\nEvidence:\n${evidencePrompt(input.sources)}`, ...STRUCTURED_GENERATION_SETTINGS, maxRetries: 1, abortSignal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS) }); return { id: crypto.randomUUID(), runId: input.runId, skillIds: input.skillIds, version: 1, ...requireObjectFromText(result.text, synthesisSchema), findings, sources: input.sources, freshAt: new Date().toISOString() }; }
  catch {
    try {
      const plain = await generateText({ model: modelProvider.model("SYNTHESIS"), system: `${RESEARCH_CORE_PROMPT}\n${input.skillPrompts.join("\n\n")}\nWrite a cohesive plain-text report from supplied verified results only. Preserve disagreements, limitations, and bracketed source IDs. Do not output JSON.`, prompt: `Question: ${input.query}\nVerified results:\n${JSON.stringify(input.specialistResults)}\nEvidence:\n${evidencePrompt(input.sources)}`, temperature: 0.2, maxRetries: 0, abortSignal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS) });
      return { id: crypto.randomUUID(), runId: input.runId, skillIds: input.skillIds, version: 1, title: `Research: ${input.query.slice(0, 100)}`, executiveAnswer: plain.text.trim() || input.specialistResults.map(result => result.summary).join("\n\n"), recommendations: [], alternatives: [], tradeoffs: [], risks: ["The structured synthesis failed; this source-grounded plain-text synthesis is degraded."], assumptions: ["Review the cited findings directly."], findings, sources: input.sources, freshAt: new Date().toISOString(), degraded: true };
    } catch { return { id: crypto.randomUUID(), runId: input.runId, skillIds: input.skillIds, version: 1, title: `Research: ${input.query.slice(0, 100)}`, executiveAnswer: input.specialistResults.map(result => result.summary).join("\n\n"), recommendations: [], alternatives: [], tradeoffs: [], risks: ["The synthesis model returned malformed structured output; review the cited findings directly."], assumptions: ["This is a degraded evidence-only report."], findings, sources: input.sources, freshAt: new Date().toISOString(), degraded: true }; }
  }
}
export function findingsFrom(results: SpecialistResult[]): Finding[] { return results.flatMap(result => result.findings).map(finding => findingSchema.parse(finding)); }
