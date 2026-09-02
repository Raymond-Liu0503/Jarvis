import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isOperator } from "@/lib/operator-auth";
import { cancelOperatorRun } from "@/lib/ops";

export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isOperator(user)) return NextResponse.json({ error: "Operator role required" }, { status: 403 });
  const cancelled = await cancelOperatorRun((await params).runId, user.id);
  return cancelled ? NextResponse.json({ cancelled: true }) : NextResponse.json({ error: "Run not found or already terminal" }, { status: 409 });
}
