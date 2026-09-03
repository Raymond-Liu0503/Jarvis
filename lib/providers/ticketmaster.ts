import type { Source } from "@/lib/contracts";
import type { EventsProvider, ProviderResult } from "@/lib/providers/contracts";
import { expiresAt, fetchProviderJson, providerSignal } from "@/lib/providers/http";

type TicketmasterEvent = { id?: string; name?: string; url?: string; dates?: { start?: { dateTime?: string; localDate?: string; localTime?: string }; end?: { dateTime?: string }; status?: { code?: string } }; priceRanges?: Array<{ min?: number; max?: number; currency?: string }>; _embedded?: { venues?: Array<{ name?: string; city?: { name?: string }; country?: { countryCode?: string }; timezone?: string }> } };

export class TicketmasterProvider implements EventsProvider {
  constructor(private readonly apiKey = process.env.TICKETMASTER_API_KEY) {}

  async events(place: string, start: string, end: string, keyword?: string): Promise<ProviderResult<unknown[]>> {
    if (!this.apiKey) throw new Error("TICKETMASTER_API_KEY is not configured");
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    url.searchParams.set("apikey", this.apiKey); url.searchParams.set("city", place);
    url.searchParams.set("startDateTime", start); url.searchParams.set("endDateTime", end);
    url.searchParams.set("size", "10"); url.searchParams.set("sort", "date,asc");
    if (keyword) url.searchParams.set("keyword", keyword);
    const payload = await fetchProviderJson(url, { signal: providerSignal(undefined) }, "Ticketmaster") as { _embedded?: { events?: TicketmasterEvent[] } };
    const data = (payload._embedded?.events ?? []).slice(0, 10).map(event => {
      const venue = event._embedded?.venues?.[0];
      return { id: event.id, name: event.name, url: event.url, start: event.dates?.start, end: event.dates?.end, status: event.dates?.status?.code, venue: venue ? { name: venue.name, city: venue.city?.name, country: venue.country?.countryCode, timezone: venue.timezone } : undefined, priceRanges: event.priceRanges?.slice(0, 3) ?? [] };
    });
    const retrievedAt = new Date();
    const sources: Source[] = data.flatMap((event, index) => event.url ? [{ id: `ticketmaster-${event.id ?? index}`, canonicalUrl: event.url, title: event.name ?? "Ticketmaster event", publisher: "Ticketmaster", publishedAt: null, retrievedAt: retrievedAt.toISOString(), excerpt: `${event.start?.dateTime ?? event.start?.localDate ?? "Date unavailable"}${event.venue?.name ? ` at ${event.venue.name}` : ""}; status ${event.status ?? "unknown"}.`, type: "event" as const }] : []);
    return { data, provider: "ticketmaster-discovery", retrievedAt: retrievedAt.toISOString(), expiresAt: expiresAt(retrievedAt, 6 * 60 * 60_000), sources };
  }
}

export const ticketmasterProvider = new TicketmasterProvider();
