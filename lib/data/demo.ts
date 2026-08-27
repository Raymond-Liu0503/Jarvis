import type { HubSnapshot, ResearchMode } from "@/lib/contracts";

const now = new Date();
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();
const minutesAhead = (n: number) => new Date(now.getTime() + n * 60_000).toISOString();

export type HubItem = { id: string; eyebrow: string; title: string; value: string; change?: string; detail: string; stale?: boolean; tag?: string };
export type HubData = { heading: string; intro: string; items: HubItem[]; secondaryTitle: string; secondary: HubItem[]; reports: string[] };

export const DEMO_HUBS: Record<ResearchMode, HubData> = {
  stocks: {
    heading: "Your market desk", intro: "A calm view of what moved, what changed, and what deserves research.",
    items: [
      { id: "aapl", eyebrow: "NASDAQ · MARKET OPEN", title: "Apple", value: "$229.74", change: "+1.24%", detail: "AAPL · refreshed 2m ago", tag: "Headline: Services momentum in focus" },
      { id: "nvda", eyebrow: "NASDAQ · DELAYED", title: "NVIDIA", value: "$181.62", change: "−0.38%", detail: "NVDA · refreshed 18m ago", tag: "Earnings in 14 days" },
      { id: "msft", eyebrow: "NASDAQ · STALE", title: "Microsoft", value: "$504.31", change: "+0.51%", detail: "MSFT · refreshed 42m ago", stale: true, tag: "Refresh recommended" },
    ], secondaryTitle: "Market pulse", secondary: [
      { id: "spx", eyebrow: "INDEX CONTEXT", title: "S&P 500", value: "+0.42%", detail: "Broad participation · delayed 15m" },
      { id: "movers", eyebrow: "MOST ACTIVE", title: "NVDA · TSLA · AMD", value: "184M", detail: "Combined observed volume" },
      { id: "filings", eyebrow: "WATCHLIST", title: "2 notable filings", value: "Today", detail: "AAPL 8-K · MSFT Form 4" },
    ], reports: ["Apple: Services growth and valuation", "Semiconductor risk map", "Cloud leaders comparison"],
  },
  travel: {
    heading: "Trips in motion", intro: "Keep the practical details close and explore what makes a place worth the journey.",
    items: [
      { id: "lisbon", eyebrow: "IN 23 DAYS · 82% PLANNED", title: "Lisbon", value: "23°C", detail: "Oct 18–25 · 2 travelers", tag: "Clear conditions forecast" },
      { id: "kyoto", eyebrow: "IN 71 DAYS · 45% PLANNED", title: "Kyoto", value: "14°C", detail: "Dec 5–12 · 2 travelers", tag: "3 seasonal events found" },
    ], secondaryTitle: "Around your destinations", secondary: [
      { id: "event", eyebrow: "LISBON · OCT 20", title: "Open House Lisboa", value: "Free", detail: "Architecture across the city" },
      { id: "place", eyebrow: "KYOTO · RECOMMENDED", title: "Philosopher’s Path", value: "4.7", detail: "Quiet morning walk · 2.1 km" },
      { id: "flight", eyebrow: "FLIGHT OFFERS", title: "Connect Duffel", value: "Off", detail: "Read-only offers require production access" },
    ], reports: ["Seven days in Lisbon without rushing", "Kyoto winter neighborhood guide", "Portugal rail feasibility"],
  },
  shopping: {
    heading: "Things worth tracking", intro: "Observed prices and thoughtful comparisons—not a noisy deal feed.",
    items: [
      { id: "headphones", eyebrow: "IN STOCK · SONY", title: "WH-1000XM6", value: "$448 CAD", change: "−5.1%", detail: "Observed 28m ago · target $425", tag: "Price moved since last snapshot" },
      { id: "camera", eyebrow: "UNAVAILABLE · FUJIFILM", title: "X100VI", value: "$2,159 CAD", detail: "Observed 3h ago · first-party listing", tag: "Needs attention" },
      { id: "chair", eyebrow: "STALE · HERMAN MILLER", title: "Aeron Chair", value: "$1,780 CAD", detail: "Observed 9h ago · target $1,600", stale: true, tag: "Refresh recommended" },
    ], secondaryTitle: "Alternatives from your research", secondary: [
      { id: "bose", eyebrow: "HEADPHONES", title: "Bose QuietComfort Ultra", value: "$499 CAD", detail: "Better comfort · weaker battery" },
      { id: "ricoh", eyebrow: "COMPACT CAMERA", title: "Ricoh GR IIIx", value: "$1,399 CAD", detail: "Smaller · fixed 40mm-equivalent lens" },
    ], reports: ["Best headphones for focused travel", "Premium task chairs compared", "Compact cameras: portability vs controls"],
  },
};

export function snapshotsFor(mode: ResearchMode): HubSnapshot<HubItem>[] {
  return DEMO_HUBS[mode].items.map((item, index) => ({
    id: `demo-${mode}-${item.id}`, hub: mode, cardType: "tracked-item", trackedItemId: item.id, data: item,
    provider: "demo-cache", retrievedAt: minutesAgo(index * 20 + 2), expiresAt: item.stale ? minutesAgo(1) : minutesAhead(20),
  }));
}
