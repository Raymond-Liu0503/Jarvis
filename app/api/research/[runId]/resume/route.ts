import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRuntimeConfig } from "@/lib/runtime-config";

const requestSchema = z.object({ message: z.string().trim().min(1).max(4000) });

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid resume request", issues: parsed.error.issues }, { status: 400 });
  if (getRuntimeConfig().RESEARCH_EXECUTION_BACKEND !== "postgres") {
    return NextResponse.json({ error: "Research resume requires the Postgres execution backend." }, { status: 503 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { data, error } = await supabase.rpc("resume_research", { p_run_id: runId, p_message: parsed.data.message });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ threadId: result.thread_id, runId: result.run_id, status: result.status }, { status: 202 });
}
