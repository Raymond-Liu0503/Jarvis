import { NextResponse } from "next/server";
import { isExpired } from "@/lib/config";
import { DEMO_DASHBOARD, dashboardSnapshots } from "@/lib/data/demo";
export async function GET() { const snapshots = dashboardSnapshots(); return NextResponse.json({ cached: true, data: DEMO_DASHBOARD, snapshots: snapshots.map(item => ({ ...item, stale: isExpired(item.expiresAt) })), staleSnapshotIds: snapshots.filter(item => isExpired(item.expiresAt)).map(item => item.id) }); }
