import { NextResponse } from "next/server";
import { runStore } from "@/lib/research/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { getPostgresRun } from "@/lib/research/postgres-runs";
export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (getRuntimeConfig().RESEARCH_EXECUTION_BACKEND === "postgres") {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { data: cancelled, error } = await supabase.rpc("cancel_research", { p_run_id: runId });
    if (error) return NextResponse.json({ error: "Could not cancel research", detail: error.message }, { status: 503 });
    if (!cancelled) return NextResponse.json({ error: "Run not found or already terminal" }, { status: 404 });
    const run = await getPostgresRun(user.id, runId);
    return NextResponse.json(run);
  }
  const run = runStore.cancel(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(run);
}
