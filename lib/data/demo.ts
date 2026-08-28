import type { HubSnapshot } from "@/lib/contracts";
const now = new Date(); const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000).toISOString(); const minutesAhead = (n: number) => new Date(now.getTime() + n * 60_000).toISOString();
export type HubItem = { id: string; skillId: string; eyebrow: string; title: string; value: string; change?: string; detail: string; stale?: boolean; tag?: string };
export type DashboardData = { heading: string; intro: string; items: HubItem[]; reports: string[] };
export const DEMO_DASHBOARD: DashboardData = { heading: "Your research desk", intro: "Markets, trips, products, and open questions—researched from one calm workspace.", items: [
  { id: "aapl", skillId: "stock-analysis", eyebrow: "STOCK · NASDAQ", title: "Apple", value: "$229.74", change: "+1.24%", detail: "AAPL · refreshed 2m ago", tag: "Services momentum in focus" },
  { id: "lisbon", skillId: "travel-planning", eyebrow: "TRAVEL · IN 23 DAYS", title: "Lisbon", value: "23°C", detail: "Oct 18–25 · 2 travelers", tag: "82% planned" },
  { id: "headphones", skillId: "product-research", eyebrow: "PRODUCT · SONY", title: "WH-1000XM6", value: "$448 CAD", change: "−5.1%", detail: "Observed 28m ago · target $425", tag: "Price moved" },
  { id: "nvda", skillId: "stock-analysis", eyebrow: "STOCK · NASDAQ", title: "NVIDIA", value: "$181.62", change: "−0.38%", detail: "NVDA · refreshed 18m ago", tag: "Earnings in 14 days" },
  { id: "kyoto", skillId: "travel-planning", eyebrow: "TRAVEL · IN 71 DAYS", title: "Kyoto", value: "14°C", detail: "Dec 5–12 · 2 travelers", tag: "3 seasonal events found" },
  { id: "camera", skillId: "product-research", eyebrow: "PRODUCT · FUJIFILM", title: "X100VI", value: "$2,159 CAD", detail: "Observed 3h ago", stale: true, tag: "Availability needs verification" },
], reports: ["Apple: Services growth and valuation", "Seven days in Lisbon without rushing", "Best headphones for focused travel"] };
export function dashboardSnapshots(): HubSnapshot<HubItem>[] { return DEMO_DASHBOARD.items.map((item, index) => ({ id: `demo-${item.skillId}-${item.id}`, skillId: item.skillId, cardType: "tracked-item", trackedItemId: item.id, data: item, provider: "demo-cache", retrievedAt: minutesAgo(index * 20 + 2), expiresAt: item.stale ? minutesAgo(1) : minutesAhead(20) })); }
