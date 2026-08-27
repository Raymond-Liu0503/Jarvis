import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { z } from "zod";
import { MODE_DEFINITIONS } from "@/lib/research/modes";
import { researchModes } from "@/lib/contracts";

const schema = z.object({ mode: z.enum(researchModes), message: z.string().min(1).max(4000) });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return Response.json({ error: "Invalid chat request" }, { status: 400 });
  if (!process.env.OPENROUTER_API_KEY || !process.env.MODEL_FAST) return Response.json({ error: "Quick chat requires OPENROUTER_API_KEY and MODEL_FAST. The dashboard remains available in demo mode." }, { status: 503 });
  const openrouter = createOpenAICompatible({ name: "openrouter", apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });
  const definition = MODE_DEFINITIONS[parsed.data.mode];
  const result = streamText({ model: openrouter(process.env.MODEL_FAST), system: `You are Jarvis in ${definition.label} mode. Be concise. Search only when freshness or evidence requires it. ${definition.disclaimer}`, prompt: parsed.data.message });
  return result.toTextStreamResponse();
}
