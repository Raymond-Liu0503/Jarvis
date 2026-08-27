import { NextResponse } from "next/server";
import { getModeDefinition } from "@/lib/research/modes";
import { DEMO_HUBS, snapshotsFor } from "@/lib/data/demo";
import { isExpired } from "@/lib/config";

export async function GET(_: Request, { params }: { params: Promise<{ hub: string }> }) {
  const { hub } = await params; const definition = getModeDefinition(hub);
  if (!definition) return NextResponse.json({ error: "Unknown hub" }, { status: 404 });
  const snapshots = snapshotsFor(definition.mode);
  return NextResponse.json({ mode: definition.mode, cached: true, data: DEMO_HUBS[definition.mode], snapshots: snapshots.map(snapshot => ({ ...snapshot, stale: isExpired(snapshot.expiresAt) })), staleSnapshotIds: snapshots.filter(snapshot => isExpired(snapshot.expiresAt)).map(snapshot => snapshot.id) });
}
