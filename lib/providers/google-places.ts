import type { Source } from "@/lib/contracts";
import type { PlacesProvider, ProviderResult } from "@/lib/providers/contracts";

type GooglePlace = {
  id?: string;
  name?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  types?: string[];
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[]; nextOpenTime?: string; nextCloseTime?: string };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  accessibilityOptions?: Record<string, boolean>;
  timeZone?: { id?: string };
  utcOffsetMinutes?: number;
};

const TTL_MS = 6 * 60 * 60_000;
const FIELD_MASK = [
  "places.id", "places.name", "places.displayName", "places.formattedAddress", "places.googleMapsUri",
  "places.websiteUri", "places.rating", "places.userRatingCount", "places.priceLevel", "places.types",
  "places.businessStatus", "places.currentOpeningHours", "places.regularOpeningHours", "places.accessibilityOptions",
  "places.timeZone", "places.utcOffsetMinutes",
].join(",");

export class GooglePlacesProvider implements PlacesProvider {
  constructor(private readonly apiKey = process.env.GOOGLE_PLACES_API_KEY) {}

  async places(place: string, interests: string[] = []): Promise<ProviderResult<unknown[]>> {
    if (!this.apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not configured");
    const retrievedAt = new Date();
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify({ textQuery: `${interests.join(" ")} ${place}`.trim(), languageCode: "en", pageSize: 10 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Google Places request failed (${response.status})`);
    const payload = await response.json() as { places?: GooglePlace[] };
    const data = (payload.places ?? []).map(item => ({
      id: item.id, name: item.displayName?.text ?? item.name ?? "Unknown place", address: item.formattedAddress,
      mapsUrl: item.googleMapsUri, websiteUrl: item.websiteUri, rating: item.rating, reviewCount: item.userRatingCount,
      priceLevel: item.priceLevel, types: item.types ?? [], businessStatus: item.businessStatus,
      openingHours: item.currentOpeningHours, regularOpeningHours: item.regularOpeningHours,
      accessibility: item.accessibilityOptions, timeZone: item.timeZone?.id, utcOffsetMinutes: item.utcOffsetMinutes,
    }));
    const sources: Source[] = data.flatMap((item, index) => item.mapsUrl ? [{
      id: `google-place-${item.id ?? index}`, canonicalUrl: item.mapsUrl, title: item.name, publisher: "Google Maps",
      publishedAt: null, retrievedAt: retrievedAt.toISOString(), excerpt: [item.address, item.rating ? `Rating ${item.rating}` : null].filter(Boolean).join(" · "), type: "place",
    }] : []);
    return { data, provider: "google-places-new", retrievedAt: retrievedAt.toISOString(), expiresAt: new Date(retrievedAt.getTime() + TTL_MS).toISOString(), sources };
  }
}

export const googlePlacesProvider = new GooglePlacesProvider();
