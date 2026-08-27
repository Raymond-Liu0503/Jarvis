import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelProvider, ModelRole } from "@/lib/providers/contracts";

const ENV_BY_ROLE = { FAST: "MODEL_FAST", REASONING: "MODEL_REASONING", SYNTHESIS: "MODEL_SYNTHESIS" } as const;

export class OpenRouterModelProvider implements ModelProvider {
  private provider() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
    return createOpenAICompatible({ name: "openrouter", apiKey, baseURL: "https://openrouter.ai/api/v1" });
  }
  configured(role: ModelRole) { return Boolean(process.env.OPENROUTER_API_KEY && process.env[ENV_BY_ROLE[role]]); }
  model(role: ModelRole) {
    const modelId = process.env[ENV_BY_ROLE[role]];
    if (!modelId) throw new Error(`${ENV_BY_ROLE[role]} is not configured`);
    return this.provider()(modelId);
  }
}

export const modelProvider = new OpenRouterModelProvider();
