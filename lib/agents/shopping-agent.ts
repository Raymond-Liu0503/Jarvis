import { BaseResearchAgent } from "@/lib/agents/base-agent";
import { loadAgentConfig } from "@/lib/agents/config-loader";
export class ShoppingAgent extends BaseResearchAgent { constructor() { super(loadAgentConfig("shopping")); } }
export const shoppingAgent = new ShoppingAgent();
