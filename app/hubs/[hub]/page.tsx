import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HubDashboard } from "@/components/hub-dashboard";
import { DEMO_HUBS } from "@/lib/data/demo";
import { getModeDefinition } from "@/lib/research/modes";

export default async function HubPage({ params }: { params: Promise<{ hub: string }> }) {
  const { hub } = await params; const definition = getModeDefinition(hub); if (!definition) notFound();
  return <AppShell mode={definition.mode}><HubDashboard mode={definition.mode} data={DEMO_HUBS[definition.mode]}/></AppShell>;
}
