import type { HubDefinition, ResearchMode } from "@/lib/contracts";

/** UI-safe metadata. Prompt and tool configuration lives in each agent manifest. */
export const MODE_DEFINITIONS = {
  stocks: { mode: "stocks", label: "Stocks", description: "Company evidence, market context, and risk", accent: "lime", disclaimer: "Informational only — not personalized financial advice.", specialists: [{ id: "fundamentals", label: "Fundamentals & filings", focus: "financial statements, earnings and filings" }, { id: "market", label: "Market & news", focus: "price context, catalysts and current news" }, { id: "risk", label: "Risk & comparables", focus: "risks, valuation and peers" }] },
  travel: { mode: "travel", label: "Travel", description: "Trips, conditions, events, and feasibility", accent: "cyan", disclaimer: "Prices and availability require verification with the provider.", specialists: [{ id: "logistics", label: "Logistics & schedule", focus: "routes, timing and itinerary" }, { id: "destination", label: "Destinations & events", focus: "places, weather and local events" }, { id: "budget", label: "Budget & feasibility", focus: "cost, constraints and alternatives" }] },
  shopping: { mode: "shopping", label: "Shopping", description: "Products, alternatives, price, and reliability", accent: "violet", disclaimer: "Observed prices are snapshots; verify price and availability with the seller.", specialists: [{ id: "fit", label: "Specifications & fit", focus: "requirements, specifications and compatibility" }, { id: "price", label: "Price & alternatives", focus: "observed price and competing products" }, { id: "reviews", label: "Reviews & reliability", focus: "reliability, support and review patterns" }] },
} as const satisfies Record<ResearchMode, HubDefinition>;

export function getModeDefinition(value: string): HubDefinition | null { return value in MODE_DEFINITIONS ? MODE_DEFINITIONS[value as ResearchMode] : null; }
