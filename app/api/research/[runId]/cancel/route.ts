import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { runStore } from "@/lib/research/store";
export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) { const { runId } = await params; const run = runStore.cancel(runId); if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 }); if (process.env.INNGEST_EVENT_KEY) await inngest.send({ name: "research/cancelled", data: { runId } }); return NextResponse.json(run); }
