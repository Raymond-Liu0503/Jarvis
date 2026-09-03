import type { Source } from "@/lib/contracts";
import type { ProviderResult, RoutesProvider } from "@/lib/providers/contracts";
import { expiresAt, fetchProviderJson, providerSignal } from "@/lib/providers/http";

const FIELD_MASK = [
  "routes.distanceMeters", "routes.duration", "routes.staticDuration", "routes.localizedValues",
  "routes.travelAdvisory.transitFare", "routes.legs.distanceMeters", "routes.legs.duration",
  "routes.legs.startLocation", "routes.legs.endLocation", "routes.legs.steps.distanceMeters",
  "routes.legs.steps.staticDuration", "routes.legs.steps.navigationInstruction",
  "routes.legs.steps.transitDetails", "routes.legs.steps.travelMode",
].join(",");

const travelMode = { transit: "TRANSIT", drive: "DRIVE", walk: "WALK", bicycle: "BICYCLE" } as const;

export class GoogleRoutesProvider implements RoutesProvider {
  constructor(private readonly apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY) {}

  async routes(input: Parameters<RoutesProvider["routes"]>[0]): Promise<ProviderResult<unknown[]>> {
    if (!this.apiKey) throw new Error("GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY is not configured");
    if (input.departureTime && input.arrivalTime) throw new Error("Google Routes accepts either departureTime or arrivalTime, not both");
    const body: Record<string, unknown> = {
      origin: { address: input.origin }, destination: { address: input.destination },
      travelMode: travelMode[input.mode], languageCode: "en-US", units: "METRIC",
      computeAlternativeRoutes: input.mode !== "transit",
    };
    if (input.departureTime) body.departureTime = input.departureTime;
    if (input.arrivalTime && input.mode === "transit") body.arrivalTime = input.arrivalTime;
    const payload = await fetchProviderJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(body), signal: providerSignal(undefined),
    }, "Google Routes") as { routes?: unknown[] };
    const data = (payload.routes ?? []).slice(0, 3);
    const retrievedAt = new Date();
    const mapsUrl = new URL("https://www.google.com/maps/dir/");
    mapsUrl.searchParams.set("api", "1"); mapsUrl.searchParams.set("origin", input.origin); mapsUrl.searchParams.set("destination", input.destination);
    mapsUrl.searchParams.set("travelmode", input.mode === "bicycle" ? "bicycling" : input.mode === "drive" ? "driving" : input.mode);
    const source: Source = { id: `google-route-${crypto.randomUUID()}`, canonicalUrl: mapsUrl.toString(), title: `${input.origin} to ${input.destination} route`, publisher: "Google Maps", publishedAt: null, retrievedAt: retrievedAt.toISOString(), excerpt: `${input.mode} route with ${data.length} alternative${data.length === 1 ? "" : "s"}; verify live service conditions before departure.`, type: "web" };
    return { data, provider: "google-routes", retrievedAt: retrievedAt.toISOString(), expiresAt: expiresAt(retrievedAt, 60 * 60_000), sources: [source] };
  }
}

export const googleRoutesProvider = new GoogleRoutesProvider();
