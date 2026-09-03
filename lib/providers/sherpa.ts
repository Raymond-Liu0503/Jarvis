import type { Source } from "@/lib/contracts";
import type { ProviderResult, TravelRequirementsProvider } from "@/lib/providers/contracts";
import { expiresAt, fetchProviderJson, providerSignal } from "@/lib/providers/http";

type JsonApiResource = { id?: string; type?: string; attributes?: Record<string, unknown>; relationships?: Record<string, unknown> };

function compactResources(value: unknown) {
  const resources = Array.isArray(value) ? value : [];
  return resources.slice(0, 30).map((item: JsonApiResource) => ({ id: item.id, type: item.type, attributes: item.attributes, relationships: item.relationships }));
}

export class SherpaProvider implements TravelRequirementsProvider {
  constructor(private readonly apiKey = process.env.SHERPA_API_KEY, private readonly baseUrl = process.env.SHERPA_API_BASE_URL ?? "https://requirements-api.joinsherpa.com") {}

  async requirements(input: Parameters<TravelRequirementsProvider["requirements"]>[0]): Promise<ProviderResult<unknown>> {
    if (!this.apiKey) throw new Error("SHERPA_API_KEY is not configured");
    const segment = { date: input.departureDate, time: "00:00", travelMode: "AIR" };
    const route = [
      { type: "ORIGIN", locationCode: input.origin.toUpperCase(), departure: segment },
      ...(input.transits ?? []).map(locationCode => ({ type: "TRANSIT", locationCode: locationCode.toUpperCase(), arrival: segment, departure: segment })),
      { type: "DESTINATION", locationCode: input.destination.toUpperCase(), arrival: segment },
    ];
    const url = new URL("/v3/trips", this.baseUrl);
    url.searchParams.set("include", "restriction,procedure");
    const payload = await fetchProviderJson(url, {
      method: "POST", headers: { "Content-Type": "application/vnd.api+json", "x-api-key": this.apiKey },
      body: JSON.stringify({ data: { type: "TRIP", attributes: { locale: "en-US", currency: input.currency ?? "USD", traveller: { passports: [input.passport.toUpperCase()] }, travelNodes: route } } }),
      signal: providerSignal(undefined),
    }, "Sherpa") as { data?: JsonApiResource; included?: JsonApiResource[]; meta?: unknown };
    const data = { trip: payload.data ? { id: payload.data.id, type: payload.data.type, attributes: payload.data.attributes } : null, requirements: compactResources(payload.included), meta: payload.meta };
    const retrievedAt = new Date();
    const source: Source = { id: `sherpa-${input.passport}-${input.destination}-${input.departureDate}`, canonicalUrl: "https://www.joinsherpa.com/", title: `${input.destination.toUpperCase()} travel requirements`, publisher: "Sherpa", publishedAt: null, retrievedAt: retrievedAt.toISOString(), excerpt: `Entry and travel requirements for a ${input.passport.toUpperCase()} passport travelling ${input.origin.toUpperCase()} to ${input.destination.toUpperCase()} on ${input.departureDate}. Recheck with official authorities before travel.`, type: "web" };
    return { data, provider: "sherpa-requirements", retrievedAt: retrievedAt.toISOString(), expiresAt: expiresAt(retrievedAt, 60 * 60_000), sources: [source] };
  }
}

export const sherpaProvider = new SherpaProvider();
