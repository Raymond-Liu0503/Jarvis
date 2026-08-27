import { z } from "zod";

export const researchModes = ["stocks", "travel", "shopping"] as const;
export const researchDepths = ["quick", "deep"] as const;
export const runStatuses = ["needs_input", "queued", "running", "partial", "completed", "failed", "cancelled"] as const;
export type ResearchMode = (typeof researchModes)[number];
export type ResearchDepth = (typeof researchDepths)[number];
export type RunStatus = (typeof runStatuses)[number];

export const sourceSchema = z.object({
  id: z.string(), canonicalUrl: z.string().url(), title: z.string(), publisher: z.string(),
  publishedAt: z.string().datetime().nullable(), retrievedAt: z.string().datetime(), excerpt: z.string(),
  type: z.enum(["filing", "news", "market", "weather", "place", "event", "commerce", "web"]),
});
export type Source = z.infer<typeof sourceSchema>;

export const findingSchema = z.object({
  specialist: z.string(), claim: z.string(), confidence: z.number().min(0).max(1),
  sourceIds: z.array(z.string()), caveats: z.array(z.string()),
});
export type Finding = z.infer<typeof findingSchema>;

export const specialistResultSchema = z.object({
  specialist: z.string(),
  summary: z.string(),
  findings: z.array(findingSchema),
  limitations: z.array(z.string()).default([]),
});
export type SpecialistResult = z.infer<typeof specialistResultSchema>;

export const specialistProgressStates = ["queued", "planning", "searching", "analyzing", "completed", "failed"] as const;
export type SpecialistProgressState = (typeof specialistProgressStates)[number];

export type ToolId = "webSearch" | "marketData" | "marketOverview" | "financialDatasets" | "weather" | "places" | "events" | "flightOffers" | "commerceSnapshot";
export type EvidencePolicy = { preferredSourceTypes: readonly Source["type"][]; minimumSources: number; primarySourcesFirst: boolean };

export type HubSnapshot<T = unknown> = {
  id: string; hub: ResearchMode; cardType: string; trackedItemId?: string; data: T; provider: string;
  retrievedAt: string; expiresAt: string; error?: string;
};

export type ResearchReport = {
  id: string; runId: string; mode: ResearchMode; version: number; title: string; executiveAnswer: string;
  recommendations: string[]; alternatives: string[]; tradeoffs: string[]; risks: string[]; assumptions: string[];
  findings: Finding[]; sources: Source[]; freshAt: string;
};

export const researchRequestSchema = z.object({
  mode: z.enum(researchModes), depth: z.enum(researchDepths).default("deep"), query: z.string().trim().min(3).max(4000),
  threadId: z.string().uuid().optional(), trackedItemId: z.string().uuid().optional(),
});

export type SpecialistDefinition = {
  id: string; label: string; focus: string; mission: string; promptVersion: string; systemPrompt: string;
  tools: readonly ToolId[]; maxToolRounds: number; evidencePolicy: EvidencePolicy;
};
export type ResearchModeDefinition = {
  mode: ResearchMode; label: string; description: string; accent: string; disclaimer: string;
  specialists: readonly [SpecialistDefinition, SpecialistDefinition, SpecialistDefinition]; synthesisPrompt: string;
  tools: readonly ToolId[]; requiredIntake: readonly string[]; prompt: string;
};

export type HubDefinition = {
  mode: ResearchMode; label: string; description: string; accent: string; disclaimer: string;
  specialists: readonly { id: string; label: string; focus: string }[];
};
