import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
import { researchRequestSchema } from "@/lib/contracts";
import { validateIntake } from "@/lib/research/intake";
import { runStore } from "@/lib/research/store";

export async function POST(request: Request) {
  const parsed = researchRequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid research request", issues: parsed.error.issues }, { status: 400 });
  const intake = validateIntake(parsed.data.mode, parsed.data.query);
  if (!intake.complete) return NextResponse.json({ status: "needs_input", ...intake }, { status: 422 });
  const run = runStore.create(parsed.data.mode, parsed.data.query);
  if (process.env.INNGEST_EVENT_KEY) await inngest.send({ name: "research/requested", data: { runId: run.id, ...parsed.data } });
  return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
}
