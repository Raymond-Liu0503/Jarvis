import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isOperator } from "@/lib/operator-auth";
import { replayOperatorJob } from "@/lib/ops";

export async function POST(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isOperator(user)) return NextResponse.json({ error: "Operator role required" }, { status: 403 });
  try { return NextResponse.json({ job: await replayOperatorJob((await params).jobId, user.id) }, { status: 201 }); }
  catch (error) { const code = (error as { code?: string }).code; if (code === "23505" || code === "23514") return NextResponse.json({ error: "Job is not eligible for replay" }, { status: 409 }); throw error; }
}
