import type { ResearchAgent, AgentInput } from "@/lib/agents/types";
import type { ResearchModeDefinition, SpecialistDefinition } from "@/lib/contracts";
import { validateIntake } from "@/lib/research/intake";
import { EvidenceStore } from "@/lib/research/evidence";
import { runSpecialist, synthesizeReport } from "@/lib/research/agents";

export abstract class BaseResearchAgent implements ResearchAgent {
  readonly mode: ResearchModeDefinition["mode"];
  readonly definition: ResearchModeDefinition;
  readonly lenses: ResearchModeDefinition["specialists"];
  readonly quickPrompt: string;
  protected constructor(definition: ResearchModeDefinition) {
    this.definition = definition; this.mode = definition.mode; this.lenses = definition.specialists;
    this.quickPrompt = `You are the ${definition.label} research agent. ${definition.prompt} ${definition.disclaimer}`;
  }
  validateIntake(query: string) { return validateIntake(this.mode, query); }
  runLens(lens: SpecialistDefinition, input: AgentInput) {
    return runSpecialist({ definition: lens, mode: this.mode, query: input.query, evidence: input.evidence ?? new EvidenceStore(20), onProgress: input.onProgress });
  }
  synthesize(input: Parameters<ResearchAgent["synthesize"]>[0]) { return synthesizeReport({ ...input, mode: this.mode, systemPrompt: this.definition.synthesisPrompt }); }
}
