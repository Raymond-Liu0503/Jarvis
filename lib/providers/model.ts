import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelProvider, ModelRole } from "@/lib/providers/contracts";

const ENV_BY_ROLE = { FAST: "MODEL_FAST", REASONING: "MODEL_REASONING", SYNTHESIS: "MODEL_SYNTHESIS" } as const;

// The Nemotron 3 Ultra free endpoint does not support response_format, and
// NVIDIA documents malformed JSON when thinking is combined with constraints.
// Structured callers therefore prompt for JSON, validate locally, and disable
// reasoning for just those calls through OpenRouter's normalized parameter.
export const STRUCTURED_GENERATION_SETTINGS = {
  temperature: 0,
  providerOptions: { openrouter: { reasoning: { effort: "none" } } },
} as const;

export class OpenRouterModelProvider implements ModelProvider {
  private provider() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
    return createOpenAICompatible({
      name: "openrouter",
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }
  configured(role: ModelRole) { return Boolean(process.env.OPENROUTER_API_KEY && process.env[ENV_BY_ROLE[role]]); }
  model(role: ModelRole) {
    const modelId = process.env[ENV_BY_ROLE[role]];
    if (!modelId) throw new Error(`${ENV_BY_ROLE[role]} is not configured`);
    return this.provider()(modelId);
  }
}

export const modelProvider = new OpenRouterModelProvider();
