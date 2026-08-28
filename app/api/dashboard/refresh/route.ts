import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";
const lastRefresh = new Map<string, number>();
export async function POST(request: Request) { const userKey = request.headers.get("x-user-id") ?? "demo"; const prior = lastRefresh.get(userKey) ?? 0; if (Date.now() - prior < 30_000) return NextResponse.json({ error: "Refresh rate limited", retryAfterSeconds: 30 }, { status: 429 }); lastRefresh.set(userKey, Date.now()); if (process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV) await inngest.send({ name: "dashboard/refresh.requested", data: { userId: userKey } }); return NextResponse.json({ accepted: true, queuedAt: new Date().toISOString() }, { status: 202 }); }
