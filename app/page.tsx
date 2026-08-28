import { AppShell } from "@/components/app-shell";
import { HubDashboard } from "@/components/hub-dashboard";
import { DEMO_DASHBOARD } from "@/lib/data/demo";
export default function Home() { return <AppShell><HubDashboard data={DEMO_DASHBOARD}/></AppShell>; }
