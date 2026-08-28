import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { researchRequestSchema } from "@/lib/contracts";
import { conversationStore, runStore, traceStore } from "@/lib/research/store";
import { modelProvider } from "@/lib/providers/model";
import { planResearch, routeSkills } from "@/lib/skills/routing";
export async function POST(request: Request) {
  const parsed = researchRequestSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid research request", issues: parsed.error.issues }, { status: 400 });
  if (!modelProvider.configured("REASONING") || !modelProvider.configured("SYNTHESIS")) return NextResponse.json({ error: "Deep Research requires MODEL_REASONING and MODEL_SYNTHESIS." }, { status: 503 });
  if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_DEV) return NextResponse.json({ error: "Deep Research requires Inngest configuration." }, { status: 503 });
  const thread = conversationStore.ensure(parsed.data.threadId, parsed.data.query); const history = conversationStore.context(thread.id); conversationStore.add(thread.id, "user", parsed.data.query); const route = await routeSkills(parsed.data.query, history); traceStore.add(thread.id, "routing.completed", { selections: route.selections, fallback: route.fallback ?? false });
  if (route.clarification && Math.max(...route.selections.map(item => item.confidence), 0) < .7) { conversationStore.add(thread.id, "assistant", route.clarification); return NextResponse.json({ threadId: thread.id, status: "needs_input", questions: [route.clarification] }, { status: 422 }); }
  const planned = await planResearch(route.selections.map(item => item.skillId), parsed.data.query, history); if (planned.questions) { const content = planned.questions.join(" "); conversationStore.add(thread.id, "assistant", content); return NextResponse.json({ threadId: thread.id, status: "needs_input", questions: planned.questions }, { status: 422 }); }
  const run = runStore.create(thread.id, parsed.data.query, planned.plan!); traceStore.add(thread.id, "plan.created", { plan: planned.plan! }, run.id);
  try { await inngest.send({ name: "research/requested", data: { runId: run.id, run } }); } catch (error) { const message = error instanceof Error ? error.message : "Could not enqueue research"; runStore.setStatus(run.id, "failed", { error: message }); return NextResponse.json({ error: "Could not enqueue Deep Research" }, { status: 502 }); }
  return NextResponse.json({ threadId: thread.id, runId: run.id, status: run.status }, { status: 202 });
}
