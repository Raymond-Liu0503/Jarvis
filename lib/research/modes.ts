import type { ResearchMode, ResearchModeDefinition } from "@/lib/contracts";

export const MODE_DEFINITIONS = {
  stocks: {
    mode: "stocks", label: "Stocks", description: "Company evidence, market context, and risk", accent: "lime",
    disclaimer: "Informational only — not personalized financial advice.", requiredIntake: ["ticker or company"],
    tools: ["financial-datasets", "market-overview", "search"], prompt: "Analyze the company with dated, cited evidence.",
    specialists: [
      { id: "fundamentals", label: "Fundamentals & filings", focus: "financial statements, earnings and filings" },
      { id: "market", label: "Market & news", focus: "price context, catalysts and current news" },
      { id: "risk", label: "Risk & comparables", focus: "risks, valuation and peers" },
    ],
  },
  travel: {
    mode: "travel", label: "Travel", description: "Trips, conditions, events, and feasibility", accent: "cyan",
    disclaimer: "Prices and availability require verification with the provider.", requiredIntake: ["destination", "dates"],
    tools: ["weather", "places", "events", "search", "flight-offers"], prompt: "Build a practical, date-aware travel recommendation.",
    specialists: [
      { id: "logistics", label: "Logistics & schedule", focus: "routes, timing and itinerary" },
      { id: "destination", label: "Destinations & events", focus: "places, weather and local events" },
      { id: "budget", label: "Budget & feasibility", focus: "cost, constraints and alternatives" },
    ],
  },
  shopping: {
    mode: "shopping", label: "Shopping", description: "Products, alternatives, price, and reliability", accent: "violet",
    disclaimer: "Observed prices are snapshots; verify price and availability with the seller.", requiredIntake: ["product or public URL"],
    tools: ["commerce-snapshot", "search"], prompt: "Compare product fit and value using cited evidence.",
    specialists: [
      { id: "fit", label: "Specifications & fit", focus: "requirements, specifications and compatibility" },
      { id: "price", label: "Price & alternatives", focus: "observed price and competing products" },
      { id: "reviews", label: "Reviews & reliability", focus: "reliability, support and review patterns" },
    ],
  },
} as const satisfies Record<ResearchMode, ResearchModeDefinition>;

export function getModeDefinition(value: string): ResearchModeDefinition | null {
  return value in MODE_DEFINITIONS ? MODE_DEFINITIONS[value as ResearchMode] : null;
}
