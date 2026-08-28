import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { researchRequestSchema } from "@/lib/contracts";
import { conversationStore, runStore, traceStore } from "@/lib/research/store";
import { modelProvider } from "@/lib/providers/model";
import { planResearch, routeSkills } from "@/lib/skills/routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRuntimeConfig } from "@/lib/runtime-config";
export async function POST(request: Request) {
  const parsed = researchRequestSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid research request", issues: parsed.error.issues }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (getRuntimeConfig().RESEARCH_EXECUTION_BACKEND === "postgres") {
    const idempotencyKey = request.headers.get("idempotency-key") ?? crypto.randomUUID();
    let persistentThreadId = parsed.data.threadId ?? null;
    if (persistentThreadId) {
      const { data: existingThread, error: threadError } = await supabase.from("threads").select("id").eq("id", persistentThreadId).eq("user_id", user.id).maybeSingle();
      if (threadError) return NextResponse.json({ error: "Could not validate conversation", detail: threadError.message }, { status: 503 });
      if (!existingThread) persistentThreadId = null;
    }
    const { data, error } = await supabase.rpc("submit_research", {
      p_query: parsed.data.query,
      p_idempotency_key: idempotencyKey,
      p_thread_id: persistentThreadId,
    });
    if (error) return NextResponse.json({ error: "Could not enqueue Deep Research", detail: error.message }, { status: 503 });
    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ threadId: result.thread_id, runId: result.run_id, status: result.status }, { status: 202 });
  }
  if (!modelProvider.configured("REASONING") || !modelProvider.configured("SYNTHESIS")) return NextResponse.json({ error: "Deep Research requires MODEL_REASONING and MODEL_SYNTHESIS." }, { status: 503 });
  if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_DEV) return NextResponse.json({ error: "Deep Research requires Inngest configuration." }, { status: 503 });
  const thread = conversationStore.ensure(parsed.data.threadId, parsed.data.query); const history = conversationStore.context(thread.id); conversationStore.add(thread.id, "user", parsed.data.query); const route = await routeSkills(parsed.data.query, history); traceStore.add(thread.id, "routing.completed", { selections: route.selections, fallback: route.fallback ?? false });
  if (route.clarification && Math.max(...route.selections.map(item => item.confidence), 0) < .7) { conversationStore.add(thread.id, "assistant", route.clarification); return NextResponse.json({ threadId: thread.id, status: "needs_input", questions: [route.clarification] }, { status: 422 }); }
  const planned = await planResearch(route.selections.map(item => item.skillId), parsed.data.query, history); if (planned.questions) { const content = planned.questions.join(" "); conversationStore.add(thread.id, "assistant", content); return NextResponse.json({ threadId: thread.id, status: "needs_input", questions: planned.questions }, { status: 422 }); }
  const run = runStore.create(thread.id, parsed.data.query, planned.plan!); traceStore.add(thread.id, "plan.created", { plan: planned.plan! }, run.id);
  try { await inngest.send({ name: "research/requested", data: { runId: run.id, run } }); } catch (error) { const message = error instanceof Error ? error.message : "Could not enqueue research"; runStore.setStatus(run.id, "failed", { error: message }); return NextResponse.json({ error: "Could not enqueue Deep Research" }, { status: 502 }); }
  return NextResponse.json({ threadId: thread.id, runId: run.id, status: run.status }, { status: 202 });
}
