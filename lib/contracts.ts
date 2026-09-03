import { z } from "zod";

export const researchDepths = ["quick", "deep"] as const;
export const runStatuses = ["needs_input", "queued", "running", "partial", "completed", "failed", "cancelled"] as const;
export type SkillId = string;
export type ResearchDepth = (typeof researchDepths)[number];
export type RunStatus = (typeof runStatuses)[number];
export const sourceSchema = z.object({ id: z.string(), canonicalUrl: z.string().url(), title: z.string(), publisher: z.string(), publishedAt: z.string().datetime().nullable(), retrievedAt: z.string().datetime(), excerpt: z.string(), type: z.enum(["filing", "news", "market", "weather", "place", "event", "commerce", "web"]) });
export type Source = z.infer<typeof sourceSchema>;
export const findingSchema = z.object({ specialist: z.string(), claim: z.string(), confidence: z.number().min(0).max(1), sourceIds: z.array(z.string()), caveats: z.array(z.string()) });
export type Finding = z.infer<typeof findingSchema>;
export const specialistResultSchema = z.object({ specialist: z.string(), summary: z.string(), findings: z.array(findingSchema), limitations: z.array(z.string()).default([]) });
export type SpecialistResult = z.infer<typeof specialistResultSchema>;
export const specialistProgressStates = ["queued", "planning", "searching", "analyzing", "completed", "failed"] as const;
export type SpecialistProgressState = (typeof specialistProgressStates)[number];
export type ToolId = "webSearch" | "marketData" | "marketOverview" | "financialDatasets" | "weather" | "places" | "events" | "routes" | "travelRequirements" | "flightOffers" | "commerceSnapshot";
export type EvidencePolicy = {
  preferredSourceTypes: readonly Source["type"][];
  minimumSources: number;
  primarySourcesFirst: boolean;
  freshness?: {
    category?: "company" | "people" | "research paper" | "news" | "personal site" | "financial report";
    publishedWithinDays?: number;
    maxAgeHours?: number;
  };
};
export type IntakeField = { id: string; description: string; question: string; requiredWhen?: string };
export type SpecialistDefinition = { id: string; skillId: SkillId; label: string; focus: string; mission: string; promptVersion: string; systemPrompt: string; tools: readonly ToolId[]; maxToolRounds: number; evidencePolicy: EvidencePolicy };
export type ResearchSkill = { id: SkillId; name: string; description: string; version: string; instructions: string; label: string; disclaimer: string; tools: readonly ToolId[]; intake: readonly IntakeField[]; quickPrompt: string; synthesisPrompt: string; specialists: readonly SpecialistDefinition[] };
export type PlannedSpecialist = { id: string; skillId: SkillId; label: string; focus: string };
export type ResearchPlan = { skillIds: SkillId[]; skillVersions: Record<string, string>; specialists: PlannedSpecialist[]; rationale: string; fallback?: boolean };
export type ResearchReport = { id: string; runId: string; skillIds: SkillId[]; version: number; title: string; executiveAnswer: string; recommendations: string[]; alternatives: string[]; tradeoffs: string[]; risks: string[]; assumptions: string[]; findings: Finding[]; sources: Source[]; freshAt: string; degraded?: boolean };
export const researchRequestSchema = z.object({ query: z.string().trim().min(3).max(4000), threadId: z.string().uuid().optional(), trackedItemId: z.string().uuid().optional() });
export type HubSnapshot<T = unknown> = { id: string; skillId: SkillId; cardType: string; trackedItemId?: string; data: T; provider: string; retrievedAt: string; expiresAt: string; error?: string };
