import { NextResponse } from "next/server";
import { researchRequestSchema } from "@/lib/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const parsed = researchRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid research request", issues: parsed.error.issues }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key") ?? crypto.randomUUID();
  let threadId = parsed.data.threadId ?? null;
  if (threadId) {
    const { data, error } = await supabase.from("threads").select("id").eq("id", threadId).eq("user_id", user.id).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not validate conversation" }, { status: 503 });
    if (!data) threadId = null;
  }
  const { data, error } = await supabase.rpc("submit_research", { p_query: parsed.data.query, p_idempotency_key: idempotencyKey, p_thread_id: threadId });
  if (error) return NextResponse.json({ error: "Could not enqueue Deep Research", detail: error.message }, { status: error.code === "23505" ? 409 : 503 });
  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ threadId: result.thread_id, runId: result.run_id, status: result.status }, { status: 202 });
}
