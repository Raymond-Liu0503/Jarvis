import { NextResponse } from "next/server";
import { getModeDefinition } from "@/lib/research/modes";
import { inngest } from "@/lib/inngest";

const lastRefresh = new Map<string, number>();
export async function POST(request: Request, { params }: { params: Promise<{ hub: string }> }) {
  const { hub } = await params; const definition = getModeDefinition(hub); if (!definition) return NextResponse.json({ error: "Unknown hub" }, { status: 404 });
  const userKey = request.headers.get("x-user-id") ?? "demo"; const key = `${userKey}:${hub}`; const prior = lastRefresh.get(key) ?? 0;
  if (Date.now() - prior < 30_000) return NextResponse.json({ error: "Refresh rate limited", retryAfterSeconds: 30 }, { status: 429 });
  lastRefresh.set(key, Date.now()); if (process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV) await inngest.send({ name: "hub/refresh.requested", data: { hub, userId: userKey, force: true } });
  return NextResponse.json({ accepted: true, hub, queuedAt: new Date().toISOString() }, { status: 202 });
}
