import type { ResearchMode } from "@/lib/contracts";
import type { ResearchAgent } from "@/lib/agents/types";
import { financeAgent } from "@/lib/agents/finance-agent";
import { travelAgent } from "@/lib/agents/travel-agent";
import { shoppingAgent } from "@/lib/agents/shopping-agent";

export const agentRegistry = {
  stocks: financeAgent,
  travel: travelAgent,
  shopping: shoppingAgent,
} satisfies Record<ResearchMode, ResearchAgent>;

export function getResearchAgent(mode: ResearchMode) { return agentRegistry[mode]; }
export function getResearchAgentOrNull(mode: string) { return mode in agentRegistry ? agentRegistry[mode as ResearchMode] : null; }
