import { BaseResearchAgent } from "@/lib/agents/base-agent";
import { loadAgentConfig } from "@/lib/agents/config-loader";
export class TravelAgent extends BaseResearchAgent { constructor() { super(loadAgentConfig("travel")); } }
export const travelAgent = new TravelAgent();
