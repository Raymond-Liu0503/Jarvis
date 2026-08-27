import type { ResearchMode, ResearchModeDefinition, SpecialistDefinition, SpecialistResult, Source } from "@/lib/contracts";
import type { EvidenceStore } from "@/lib/research/evidence";
import type { ToolProgress } from "@/lib/research/tools";

export type AgentInput = { query: string; runId?: string; evidence?: EvidenceStore; onProgress?: ToolProgress };
export interface ResearchAgent {
  readonly mode: ResearchMode;
  readonly definition: ResearchModeDefinition;
  readonly lenses: ResearchModeDefinition["specialists"];
  readonly quickPrompt: string;
  validateIntake(query: string): { complete: boolean; missing: string[]; questions: string[] };
  runLens(lens: SpecialistDefinition, input: AgentInput): Promise<SpecialistResult>;
  synthesize(input: { runId: string; query: string; specialistResults: SpecialistResult[]; sources: Source[] }): Promise<import("@/lib/contracts").ResearchReport>;
}
