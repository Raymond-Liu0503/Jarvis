import { BaseResearchAgent } from "@/lib/agents/base-agent";
import { loadAgentConfig } from "@/lib/agents/config-loader";
export class FinanceAgent extends BaseResearchAgent { constructor() { super(loadAgentConfig("finance")); } }
export const financeAgent = new FinanceAgent();
