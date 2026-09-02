import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isOperator } from "@/lib/operator-auth";
import { getOperatorJob } from "@/lib/ops";

export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isOperator(user)) return NextResponse.json({ error: "Operator role required" }, { status: 403 });
  const result = await getOperatorJob((await params).jobId);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Job not found" }, { status: 404 });
}
