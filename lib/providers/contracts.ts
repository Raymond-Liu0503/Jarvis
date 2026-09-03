import type { Source } from "@/lib/contracts";
import type { LanguageModel } from "ai";

export type ProviderResult<T> = { data: T; provider: string; retrievedAt: string; expiresAt: string; delayed?: boolean; sources: Source[] };
export type ModelRole = "FAST" | "REASONING" | "SYNTHESIS";
export type SearchOptions = { limit?: number; category?: "company" | "people" | "research paper" | "news" | "personal site" | "financial report"; includeDomains?: string[]; excludeDomains?: string[]; startPublishedDate?: string; endPublishedDate?: string; maxAgeHours?: number; highlightQuery?: string; signal?: AbortSignal };
export interface ModelProvider { model(role: ModelRole): LanguageModel; configured(role: ModelRole): boolean; }
export interface SearchProvider { search(query: string, options?: number | SearchOptions): Promise<ProviderResult<Array<{ title: string; url: string; excerpt: string }>>>; }
export interface MarketDataProvider { quote(ticker: string): Promise<ProviderResult<{ ticker: string; price: number; currency: string; changePercent: number; marketOpen: boolean | null }>>; }
export interface MarketOverviewProvider { overview(): Promise<ProviderResult<{ indices: unknown[]; gainers: unknown[]; losers: unknown[]; active: unknown[] }>>; }
export interface FinancialDataProvider { financials(input: { ticker: string; dataset: "income" | "balance-sheet" | "cash-flow" | "metrics" | "company-facts"; period?: "annual" | "quarterly"; limit?: number }): Promise<ProviderResult<unknown>>; }
export interface FilingProvider { filings(input: { ticker: string; forms?: string[]; limit?: number }): Promise<ProviderResult<unknown[]>>; }
export interface WeatherProvider { forecast(place: string, start?: string): Promise<ProviderResult<unknown>>; }
export interface PlacesProvider { places(place: string, interests?: string[]): Promise<ProviderResult<unknown[]>>; }
export interface EventsProvider { events(place: string, start: string, end: string, keyword?: string): Promise<ProviderResult<unknown[]>>; }
export interface RoutesProvider { routes(input: { origin: string; destination: string; mode: "transit" | "drive" | "walk" | "bicycle"; departureTime?: string; arrivalTime?: string }): Promise<ProviderResult<unknown[]>>; }
export interface TravelRequirementsProvider { requirements(input: { passport: string; origin: string; destination: string; departureDate: string; transits?: string[]; currency?: "CAD" | "USD" | "EUR" | "GBP" }): Promise<ProviderResult<unknown>>; }
export interface FlightOfferProvider { offers(input: { origin: string; destination: string; departure: string; return?: string; passengers: number }): Promise<ProviderResult<unknown[]>>; }
export interface CommerceSnapshotProvider { snapshot(input: { url?: string; description?: string }): Promise<ProviderResult<{ title: string; price?: number; currency?: string; seller?: string; available?: boolean }>>; }
