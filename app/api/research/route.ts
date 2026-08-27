import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { researchRequestSchema } from "@/lib/contracts";
import { runStore } from "@/lib/research/store";
import { getResearchAgent } from "@/lib/agents/registry";
import { modelProvider } from "@/lib/providers/model";

export async function POST(request: Request) {
  const parsed = researchRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid research request", issues: parsed.error.issues }, { status: 400 });
  const agent = getResearchAgent(parsed.data.mode); const intake = agent.validateIntake(parsed.data.query);
  if (!intake.complete) return NextResponse.json({ status: "needs_input", ...intake }, { status: 422 });
  if (!modelProvider.configured("REASONING") || !modelProvider.configured("SYNTHESIS")) return NextResponse.json({ error: "Deep Research requires OPENROUTER_API_KEY, MODEL_REASONING, and MODEL_SYNTHESIS." }, { status: 503 });
  if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_DEV) return NextResponse.json({ error: "Deep Research requires INNGEST_EVENT_KEY, or INNGEST_DEV=1 with the local Inngest dev server." }, { status: 503 });
  const run = runStore.create(parsed.data.mode, parsed.data.query, agent.lenses.map(item => item.id));
  try { await inngest.send({ name: "research/requested", data: { runId: run.id, ...parsed.data } }); }
  catch (error) { runStore.setStatus(run.id, "failed", { error: error instanceof Error ? error.message : "Could not enqueue research" }); return NextResponse.json({ error: "Could not enqueue Deep Research" }, { status: 502 }); }
  return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
}
