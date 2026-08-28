import { NextResponse } from "next/server";
import { runStore } from "@/lib/research/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { getPostgresRun } from "@/lib/research/postgres-runs";
export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (getRuntimeConfig().RESEARCH_EXECUTION_BACKEND === "postgres") {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const run = await getPostgresRun(user.id, runId);
    return run ? NextResponse.json(run) : NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const run = runStore.get(runId);
  return run ? NextResponse.json(run) : NextResponse.json({ error: "Run not found" }, { status: 404 });
}
