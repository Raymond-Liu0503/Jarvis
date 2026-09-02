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
import { compactSources, compactSpecialistResults, logModelInput, SYNTHESIS_EXCERPT_CHAR_LIMIT, truncateText } from "@/lib/research/context-budget";
import { classifyWebResearchError, type WebResearchEvent } from "@/lib/research/web-research";

const synthesisSchema = z.object({ title: z.string(), executiveAnswer: z.string(), recommendations: z.array(z.string()), alternatives: z.array(z.string()), tradeoffs: z.array(z.string()), risks: z.array(z.string()), assumptions: z.array(z.string()) });
const evidencePrompt = (sources: Source[], excerptLimit = 800) => compactSources(sources, sources.length, excerptLimit).map(source => `[${source.id}] ${source.title} — ${source.publisher}\n${source.excerpt}\n${source.canonicalUrl}`).join("\n\n");
const jsonInstruction = (schema: z.ZodType) => `Return exactly one JSON object and no other text. It must match this JSON Schema: ${JSON.stringify(z.toJSONSchema(schema))}`;

function verifiedResult(definition: SpecialistDefinition, result: SpecialistResult, sources: Source[]) {
  const ids = new Set(sources.map(source => source.id));
  const findings = result.findings.slice(0, 8).filter(finding => finding.sourceIds.length > 0 && finding.sourceIds.every(id => ids.has(id))).map(finding => ({ ...finding, claim: truncateText(finding.claim, 400), caveats: finding.caveats.slice(0, 3).map(item => truncateText(item, 240)), specialist: definition.id }));
  if (!findings.length || new Set(findings.flatMap(finding => finding.sourceIds)).size < definition.evidencePolicy.minimumSources) throw new Error(`${definition.label} did not meet its evidence threshold`);
  return { ...result, summary: truncateText(result.summary, 800), specialist: definition.id, findings, limitations: result.limitations.slice(0, 4).map(item => truncateText(item, 300)) };
}

function specialistOutputSchema(definition: SpecialistDefinition, sources: Source[]) {
  const [firstSourceId, ...otherSourceIds] = sources.map(source => source.id);
  if (!firstSourceId) throw new Error(`${definition.label} has no source IDs for structured analysis`);
  const sourceIdSchema = z.enum([firstSourceId, ...otherSourceIds]);
  const constrainedFindingSchema = z.object({ specialist: z.literal(definition.id), claim: z.string().min(1).max(800), confidence: z.number().min(0).max(1), sourceIds: z.array(sourceIdSchema).min(1), caveats: z.array(z.string().max(400)).max(5) });
  return z.object({ specialist: z.literal(definition.id), summary: z.string().min(1).max(1_600), findings: z.array(constrainedFindingSchema).min(1).max(8), limitations: z.array(z.string().max(500)).max(5).default([]) });
}

export function searchOptionsFor(definition: SpecialistDefinition, now = new Date()) {
  const freshness = definition.evidencePolicy.freshness;
  if (!freshness) return {};
  const startPublishedDate = freshness.publishedWithinDays ? new Date(now.getTime() - freshness.publishedWithinDays * 24 * 60 * 60_000).toISOString() : undefined;
  return { category: freshness.category, startPublishedDate, endPublishedDate: startPublishedDate ? now.toISOString() : undefined, maxAgeHours: freshness.maxAgeHours };
}

export function fallbackSpecialistResult(definition: SpecialistDefinition, sources: Source[], summary?: string): SpecialistResult {
  const usable = sources.filter(source => source.excerpt.trim()).slice(0, Math.max(definition.evidencePolicy.minimumSources, 3));
  if (usable.length < definition.evidencePolicy.minimumSources) throw new Error(`${definition.label} could not recover enough evidence after malformed model output`);
  return { specialist: definition.id, summary: summary?.trim() || `${definition.label} retrieved ${usable.length} sources, but the reasoning model did not return valid structured analysis. The report can use the evidence excerpts below with reduced confidence.`, findings: usable.map(source => ({ specialist: definition.id, claim: truncateText(source.excerpt, 400), confidence: .35, sourceIds: [source.id], caveats: ["Degraded evidence-only finding: structured model output could not be validated."] })), limitations: [summary ? "Degraded structured output; a source-cited analysis was preserved." : "Degraded structured output; findings preserve retrieved source excerpts rather than model synthesis."] };
}

type SpecialistInput = { definition: SpecialistDefinition; query: string; userId?: string; runId?: string; threadId?: string; evidence: EvidenceStore; abortSignal?: AbortSignal; onProgress?: ToolProgress; onEvent?: WebResearchEvent };

export async function runSpecialist(input: SpecialistInput): Promise<SpecialistResult> {
  const { definition, query, evidence, onProgress, onEvent } = input;
  await onProgress?.("planning", definition.mission);
  const context: ResearchToolContext = { userId: input.userId ?? "00000000-0000-0000-0000-000000000000", runId: input.runId, threadId: input.threadId, specialistId: definition.id, objective: `${definition.mission}. Focus: ${definition.focus}`, abortSignal: input.abortSignal, evidence, calls: new ToolCallBudget(1), onProgress, onEvent };
  const { tools, unavailable } = createResearchTools(definition.tools, context);
  if (!tools.web_research) throw new Error(`${definition.label} requires the configured web-search provider`);

  let collectionError: unknown;
  try { await collectWebEvidence({ query: truncateText(`${query} ${definition.focus}`, 500), limit: 10, ...searchOptionsFor(definition) }, context); }
  catch (error) { collectionError = error; }
  const sources = evidence.all();
  if (sources.length < definition.evidencePolicy.minimumSources) {
    if (collectionError instanceof Error) throw collectionError;
    throw new Error(`${definition.label} retrieved ${sources.length} of ${definition.evidencePolicy.minimumSources} required sources`);
  }

  await onProgress?.("analyzing", `${definition.label} is evaluating ${sources.length} ranked sources`);
  const outputSchema = specialistOutputSchema(definition, sources);
  const sourceIds = sources.map(source => source.id);
  const system = `${RESEARCH_CORE_PROMPT}\n\n${definition.systemPrompt}\nUse only supplied evidence. Use specialist ${definition.id}. Return at most eight atomic findings. Every sourceIds value must be selected verbatim from ${JSON.stringify(sourceIds)} and at least ${definition.evidencePolicy.minimumSources} unique IDs must be used.\nUnavailable tools: ${unavailable.join(", ") || "none"}.\n${jsonInstruction(outputSchema)}`;
  const prompt = `Mission: ${truncateText(definition.mission, 800)}\nRequest: ${truncateText(query, 4_000)}\nEvidence:\n${evidencePrompt(sources)}`;
  const metrics = logModelInput("specialist.analysis", { system, prompt });
  let invalidText: string;
  const started = Date.now();
  try {
    const result = await generateText({ model: modelProvider.model("REASONING"), system, prompt, ...STRUCTURED_GENERATION_SETTINGS, maxOutputTokens: 2_500, maxRetries: 1, abortSignal: input.abortSignal ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS)]) : AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS) });
    invalidText = result.text;
    await onEvent?.("model.specialist", { specialistId: definition.id, model: process.env.MODEL_REASONING, status: "completed", latencyMs: Date.now() - started, estimatedInputTokens: metrics.estimatedTokens, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
  } catch (error) {
    await onEvent?.("model.specialist", { specialistId: definition.id, model: process.env.MODEL_REASONING, status: "failed", latencyMs: Date.now() - started, estimatedInputTokens: metrics.estimatedTokens, error: classifyWebResearchError(error) });
    return fallbackSpecialistResult(definition, sources);
  }
  try { return verifiedResult(definition, requireObjectFromText(invalidText, outputSchema), sources); }
  catch (validationError) {
    const catalog = compactSources(sources, 10, 200).map(source => ({ id: source.id, title: source.title, excerpt: source.excerpt }));
    const repairSystem = `Repair malformed structured output. Return only JSON matching this schema. Do not invent source IDs.\n${jsonInstruction(outputSchema)}`;
    const repairPrompt = `Validation error: ${truncateText(validationError instanceof Error ? validationError.message : String(validationError), 800)}\nInvalid output:\n${truncateText(invalidText, 4_000)}\nSource catalog:\n${JSON.stringify(catalog)}`;
    const repairMetrics = logModelInput("specialist.repair", { system: repairSystem, prompt: repairPrompt });
    const repairStarted = Date.now();
    try {
      const repair = await generateText({ model: modelProvider.model("REASONING"), system: repairSystem, prompt: repairPrompt, ...STRUCTURED_GENERATION_SETTINGS, maxOutputTokens: 2_000, maxRetries: 0, abortSignal: input.abortSignal ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS)]) : AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS) });
      await onEvent?.("model.specialist_repair", { specialistId: definition.id, model: process.env.MODEL_REASONING, status: "completed", latencyMs: Date.now() - repairStarted, estimatedInputTokens: repairMetrics.estimatedTokens, inputTokens: repair.usage.inputTokens, outputTokens: repair.usage.outputTokens });
      return verifiedResult(definition, requireObjectFromText(repair.text, outputSchema), sources);
    } catch (error) {
      await onEvent?.("model.specialist_repair", { specialistId: definition.id, model: process.env.MODEL_REASONING, status: "fallback", latencyMs: Date.now() - repairStarted, estimatedInputTokens: repairMetrics.estimatedTokens, error: classifyWebResearchError(error) });
      return fallbackSpecialistResult(definition, sources);
    }
  }
}

function degradedReport(input: { runId: string; skillIds: string[]; query: string; specialistResults: SpecialistResult[]; sources: Source[] }, findings: Finding[]): ResearchReport {
  return { id: crypto.randomUUID(), runId: input.runId, skillIds: input.skillIds, version: 1, title: `Research: ${input.query.slice(0, 100)}`, executiveAnswer: input.specialistResults.map(result => result.summary).join("\n\n"), recommendations: [], alternatives: [], tradeoffs: [], risks: ["Structured synthesis was unavailable; review the cited findings directly."], assumptions: ["This is a degraded evidence-grounded report."], findings, sources: input.sources, freshAt: new Date().toISOString(), degraded: true };
}

export async function synthesizeReport(input: { runId: string; userId?: string; skillIds: string[]; query: string; specialistResults: SpecialistResult[]; sources: Source[]; skillPrompts: string[]; abortSignal?: AbortSignal; onEvent?: WebResearchEvent }): Promise<ResearchReport> {
  const findings = input.specialistResults.flatMap(result => result.findings);
  if (!hasCitationCoverage(findings, input.sources)) throw new Error("Cannot synthesize a report with invalid citation coverage");
  const compactResults = compactSpecialistResults(input.specialistResults);
  const system = `${RESEARCH_CORE_PROMPT}\n${input.skillPrompts.map(item => truncateText(item, 2_000)).join("\n\n")}\nUse only supplied findings. Preserve disagreements and limitations. Return the requested structured report object, never Markdown.\n${jsonInstruction(synthesisSchema)}`;
  const prompt = `Question: ${truncateText(input.query, 4_000)}\nVerified specialist views:\n${JSON.stringify(compactResults)}\nEvidence:\n${evidencePrompt(input.sources.slice(0, 20), SYNTHESIS_EXCERPT_CHAR_LIMIT)}`;
  const metrics = logModelInput("research.synthesis", { system, prompt });
  let invalidText: string;
  const started = Date.now();
  try {
    const result = await generateText({ model: modelProvider.model("SYNTHESIS"), system, prompt, ...STRUCTURED_GENERATION_SETTINGS, maxOutputTokens: 3_000, maxRetries: 1, abortSignal: input.abortSignal ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS)]) : AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS) });
    invalidText = result.text;
    await input.onEvent?.("model.synthesis", { model: process.env.MODEL_SYNTHESIS, status: "completed", latencyMs: Date.now() - started, estimatedInputTokens: metrics.estimatedTokens, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
  } catch (error) {
    await input.onEvent?.("model.synthesis", { model: process.env.MODEL_SYNTHESIS, status: "fallback", latencyMs: Date.now() - started, estimatedInputTokens: metrics.estimatedTokens, error: classifyWebResearchError(error) });
    return degradedReport(input, findings);
  }
  try {
    const parsed = requireObjectFromText(invalidText, synthesisSchema);
    return { id: crypto.randomUUID(), runId: input.runId, skillIds: input.skillIds, version: 1, ...parsed, findings, sources: input.sources, freshAt: new Date().toISOString() };
  } catch (validationError) {
    const repairSystem = `Repair the malformed report object. Return only JSON matching this schema.\n${jsonInstruction(synthesisSchema)}`;
    const repairPrompt = `Validation error: ${truncateText(validationError instanceof Error ? validationError.message : String(validationError), 800)}\nInvalid output:\n${truncateText(invalidText, 4_000)}\nVerified summaries:\n${JSON.stringify(compactResults.map(result => ({ specialist: result.specialist, summary: result.summary, sourceIds: result.findings.flatMap(item => item.sourceIds) })))}`;
    const repairMetrics = logModelInput("research.synthesis_repair", { system: repairSystem, prompt: repairPrompt });
    const repairStarted = Date.now();
    try {
      const repair = await generateText({ model: modelProvider.model("SYNTHESIS"), system: repairSystem, prompt: repairPrompt, ...STRUCTURED_GENERATION_SETTINGS, maxOutputTokens: 3_000, maxRetries: 0, abortSignal: input.abortSignal ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS)]) : AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS) });
      await input.onEvent?.("model.synthesis_repair", { model: process.env.MODEL_SYNTHESIS, status: "completed", latencyMs: Date.now() - repairStarted, estimatedInputTokens: repairMetrics.estimatedTokens, inputTokens: repair.usage.inputTokens, outputTokens: repair.usage.outputTokens });
      const parsed = requireObjectFromText(repair.text, synthesisSchema);
      return { id: crypto.randomUUID(), runId: input.runId, skillIds: input.skillIds, version: 1, ...parsed, findings, sources: input.sources, freshAt: new Date().toISOString() };
    } catch (error) {
      await input.onEvent?.("model.synthesis_repair", { model: process.env.MODEL_SYNTHESIS, status: "fallback", latencyMs: Date.now() - repairStarted, estimatedInputTokens: repairMetrics.estimatedTokens, error: classifyWebResearchError(error) });
      return degradedReport(input, findings);
    }
  }
}

export function findingsFrom(results: SpecialistResult[]): Finding[] { return results.flatMap(result => result.findings).map(finding => findingSchema.parse(finding)); }
