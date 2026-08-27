import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { EvidencePolicy, ResearchModeDefinition, ToolId } from "@/lib/contracts";

const toolIds = ["webSearch", "marketData", "marketOverview", "financialDatasets", "weather", "places", "events", "flightOffers", "commerceSnapshot"] as const;
const sourceTypes = ["filing", "news", "market", "weather", "place", "event", "commerce", "web"] as const;
const rawSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/), mode: z.enum(["stocks", "travel", "shopping"]), label: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), description: z.string().min(1), accent: z.string().min(1), disclaimer: z.string().min(1),
  requiredIntake: z.array(z.string()).min(1), tools: z.array(z.enum(toolIds)).min(1),
  prompts: z.object({ quick: z.string().min(1), synthesis: z.string().min(1) }),
  limits: z.object({ sourceBudget: z.number().int().positive(), quickSearchRounds: z.number().int().nonnegative(), deepToolRounds: z.number().int().positive() }),
  lenses: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]+$/), label: z.string().min(1), focus: z.string().min(1), mission: z.string().min(1), prompt: z.string().min(1), tools: z.array(z.enum(toolIds)).min(1), minimumSources: z.number().int().positive(), preferredSourceTypes: z.array(z.enum(sourceTypes)).min(1) })).length(3),
});

function readPrompt(agentId: string, promptPath: string) {
  const root = path.resolve(process.cwd(), "agents", agentId); const file = path.resolve(root, promptPath);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Prompt path escapes agent directory: ${promptPath}`);
  if (!fs.existsSync(file)) throw new Error(`Prompt file not found: ${file}`);
  return fs.readFileSync(file, "utf8").trim();
}

export function loadAgentConfig(agentId: string): ResearchModeDefinition {
  const root = path.resolve(process.cwd(), "agents", agentId); const manifestPath = path.join(root, "agent.yaml");
  if (!fs.existsSync(manifestPath)) throw new Error(`Agent manifest not found: ${manifestPath}`);
  const raw = rawSchema.parse(parse(fs.readFileSync(manifestPath, "utf8")));
  const knownTools = new Set<ToolId>(raw.tools); const lenses = raw.lenses.map(lens => {
    if (lens.tools.some(tool => !knownTools.has(tool))) throw new Error(`${agentId}/${lens.id} uses a tool not allowed by its agent`);
    const policy: EvidencePolicy = { preferredSourceTypes: lens.preferredSourceTypes, minimumSources: lens.minimumSources, primarySourcesFirst: true };
    return { id: lens.id, label: lens.label, focus: lens.focus, mission: lens.mission, promptVersion: raw.version, systemPrompt: readPrompt(agentId, lens.prompt), tools: lens.tools, maxToolRounds: raw.limits.deepToolRounds, evidencePolicy: policy };
  });
  return { mode: raw.mode, label: raw.label, description: raw.description, accent: raw.accent, disclaimer: raw.disclaimer, requiredIntake: raw.requiredIntake, tools: raw.tools, prompt: readPrompt(agentId, raw.prompts.quick), synthesisPrompt: readPrompt(agentId, raw.prompts.synthesis), specialists: lenses as [typeof lenses[0], typeof lenses[0], typeof lenses[0]] };
}

export function loadAllAgentConfigs() { return { stocks: loadAgentConfig("finance"), travel: loadAgentConfig("travel"), shopping: loadAgentConfig("shopping") }; }
