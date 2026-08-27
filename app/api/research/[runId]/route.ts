import { NextResponse } from "next/server";
import { runStore } from "@/lib/research/store";
export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) { const { runId } = await params; const run = runStore.get(runId); return run ? NextResponse.json(run) : NextResponse.json({ error: "Run not found" }, { status: 404 }); }
