import type { Source } from "@/lib/contracts";
import type { ProviderResult, WeatherProvider } from "@/lib/providers/contracts";
import { expiresAt, fetchProviderJson, numberFrom, providerSignal } from "@/lib/providers/http";

type GeoResult = { name: string; lat: number; lon: number; country?: string; state?: string };
type ForecastItem = { dt: number; main?: { temp?: number; temp_min?: number; temp_max?: number; humidity?: number }; weather?: Array<{ description?: string }>; wind?: { speed?: number }; pop?: number };

export class OpenWeatherProvider implements WeatherProvider {
  constructor(private readonly apiKey = process.env.OPENWEATHER_API_KEY) {}

  async forecast(place: string, start?: string): Promise<ProviderResult<unknown>> {
    if (!this.apiKey) throw new Error("OPENWEATHER_API_KEY is not configured");
    const geoUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
    geoUrl.searchParams.set("q", place); geoUrl.searchParams.set("limit", "1"); geoUrl.searchParams.set("appid", this.apiKey);
    const locations = await fetchProviderJson(geoUrl, { signal: providerSignal(undefined) }, "OpenWeather") as GeoResult[];
    const location = locations[0];
    if (!location) throw new Error(`OpenWeather could not resolve ${place}`);
    const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
    forecastUrl.searchParams.set("lat", String(location.lat)); forecastUrl.searchParams.set("lon", String(location.lon));
    forecastUrl.searchParams.set("appid", this.apiKey); forecastUrl.searchParams.set("units", "metric");
    const payload = await fetchProviderJson(forecastUrl, { signal: providerSignal(undefined) }, "OpenWeather") as { list?: ForecastItem[]; city?: { id?: number; timezone?: number; name?: string; country?: string } };
    const timezoneOffset = payload.city?.timezone ?? 0;
    const grouped = new Map<string, ForecastItem[]>();
    for (const item of payload.list ?? []) {
      const date = new Date((item.dt + timezoneOffset) * 1000).toISOString().slice(0, 10);
      grouped.set(date, [...(grouped.get(date) ?? []), item]);
    }
    const days = [...grouped.entries()].map(([date, items]) => ({
      date,
      minimumC: Math.min(...items.map(item => numberFrom(item.main?.temp_min))),
      maximumC: Math.max(...items.map(item => numberFrom(item.main?.temp_max))),
      precipitationProbability: Math.max(...items.map(item => numberFrom(item.pop))),
      humidityPercent: Math.round(items.reduce((sum, item) => sum + numberFrom(item.main?.humidity), 0) / items.length),
      windMetresPerSecond: Math.max(...items.map(item => numberFrom(item.wind?.speed))),
      conditions: [...new Set(items.flatMap(item => item.weather?.map(value => value.description).filter(Boolean) ?? []))].slice(0, 4),
    })).slice(0, 6);
    const data = { location: { name: location.name, state: location.state, country: location.country, latitude: location.lat, longitude: location.lon, timezoneOffsetSeconds: timezoneOffset }, requestedStart: start, availableRange: days.length ? { start: days[0].date, end: days.at(-1)?.date } : null, units: "metric", days };
    const retrievedAt = new Date();
    const publicUrl = payload.city?.id ? `https://openweathermap.org/city/${payload.city.id}` : "https://openweathermap.org/";
    const source: Source = { id: `openweather-${location.lat}-${location.lon}`, canonicalUrl: publicUrl, title: `${location.name} weather forecast`, publisher: "OpenWeather", publishedAt: null, retrievedAt: retrievedAt.toISOString(), excerpt: `${days.length}-day forecast available ${data.availableRange?.start ?? "unknown"} to ${data.availableRange?.end ?? "unknown"}; requested start ${start ?? "not specified"}.`, type: "weather" };
    return { data, provider: "openweather", retrievedAt: retrievedAt.toISOString(), expiresAt: expiresAt(retrievedAt, 3 * 60 * 60_000), sources: [source] };
  }
}

export const openWeatherProvider = new OpenWeatherProvider();
