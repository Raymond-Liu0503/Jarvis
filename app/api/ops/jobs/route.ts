import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isOperator } from "@/lib/operator-auth";
import { listOperatorJobs } from "@/lib/ops";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isOperator(user)) return NextResponse.json({ error: "Operator role required" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  return NextResponse.json(await listOperatorJobs({ status: params.get("status") ?? undefined, kind: params.get("kind") ?? undefined, runId: params.get("runId") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined, cursor: params.get("cursor") ?? undefined, limit: Number(params.get("limit") ?? 25) }));
}
