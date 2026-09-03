import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { EvidencePolicy, ResearchSkill, SpecialistDefinition, ToolId } from "@/lib/contracts";

const toolIds = ["webSearch", "marketData", "marketOverview", "financialDatasets", "weather", "places", "events", "routes", "travelRequirements", "flightOffers", "commerceSnapshot"] as const;
const sourceTypes = ["filing", "news", "market", "weather", "place", "event", "commerce", "web"] as const;
const frontmatterSchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9-]+$/), description: z.string().min(20) });
const freshnessSchema = z.object({
  category: z.enum(["company", "people", "research paper", "news", "personal site", "financial report"]).optional(),
  publishedWithinDays: z.number().int().positive().optional(),
  maxAgeHours: z.number().int().nonnegative().optional(),
});
const manifestSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), label: z.string().min(1), disclaimer: z.string().min(1), tools: z.array(z.enum(toolIds)).min(1), intake: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]+$/), description: z.string().min(1), question: z.string().min(1), requiredWhen: z.string().min(1).optional() })).default([]), prompts: z.object({ quick: z.string(), synthesis: z.string() }), limits: z.object({ deepToolRounds: z.number().int().min(1).max(8) }), lenses: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]+$/), label: z.string(), focus: z.string(), mission: z.string(), prompt: z.string(), tools: z.array(z.enum(toolIds)).min(1), minimumSources: z.number().int().positive(), preferredSourceTypes: z.array(z.enum(sourceTypes)).min(1), freshness: freshnessSchema.optional() })).min(1) });

function safeRead(root: string, relative: string) { const file = path.resolve(root, relative); if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Skill reference escapes package: ${relative}`); if (!fs.existsSync(file)) throw new Error(`Skill reference not found: ${file}`); return fs.readFileSync(file, "utf8").trim(); }
function readSkill(root: string): ResearchSkill {
  const entry = safeRead(root, "SKILL.md"); const match = entry.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/); if (!match) throw new Error(`Invalid SKILL.md frontmatter in ${root}`);
  const meta = frontmatterSchema.parse(parse(match[1])); if (path.basename(root) !== meta.name) throw new Error(`Skill folder must match name: ${meta.name}`);
  const raw = manifestSchema.parse(parse(safeRead(root, "agents/jarvis.yaml"))); const allowed = new Set<ToolId>(raw.tools);
  const specialists: SpecialistDefinition[] = raw.lenses.map(lens => { if (lens.tools.some(tool => !allowed.has(tool))) throw new Error(`${meta.name}/${lens.id} uses a tool outside its skill allowlist`); const evidencePolicy: EvidencePolicy = { preferredSourceTypes: lens.preferredSourceTypes, minimumSources: lens.minimumSources, primarySourcesFirst: true, freshness: lens.freshness }; return { id: `${meta.name}/${lens.id}`, skillId: meta.name, label: lens.label, focus: lens.focus, mission: lens.mission, promptVersion: raw.version, systemPrompt: safeRead(root, lens.prompt), tools: lens.tools, maxToolRounds: raw.limits.deepToolRounds, evidencePolicy }; });
  return { id: meta.name, name: meta.name, description: meta.description, version: raw.version, instructions: match[2].trim(), label: raw.label, disclaimer: raw.disclaimer, tools: raw.tools, intake: raw.intake, quickPrompt: safeRead(root, raw.prompts.quick), synthesisPrompt: safeRead(root, raw.prompts.synthesis), specialists };
}
let cached: Map<string, ResearchSkill> | undefined;
export function loadSkills(root = path.resolve(process.cwd(), "skills")) { if (root === path.resolve(process.cwd(), "skills") && cached) return cached; const found = new Map<string, ResearchSkill>(); for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) { const skill = readSkill(path.join(root, entry.name)); if (found.has(skill.id)) throw new Error(`Duplicate skill: ${skill.id}`); found.set(skill.id, skill); } if (!found.has("general-research")) throw new Error("The general-research fallback skill is required"); if (root === path.resolve(process.cwd(), "skills")) cached = found; return found; }
export function getSkill(id: string) { const skill = loadSkills().get(id); if (!skill) throw new Error(`Unknown skill: ${id}`); return skill; }
export function skillCatalog() { return [...loadSkills().values()].map(({ id, description }) => ({ id, description })); }
