import { afterEach, describe, expect, it, vi } from "vitest";
import { AlphaVantageProvider } from "@/lib/providers/alpha-vantage";
import { FinancialDatasetsProvider } from "@/lib/providers/financial-datasets";
import { GooglePlacesProvider } from "@/lib/providers/google-places";
import { GoogleRoutesProvider } from "@/lib/providers/google-routes";
import { OpenWeatherProvider } from "@/lib/providers/openweather";
import { SecEdgarProvider } from "@/lib/providers/sec-edgar";
import { SherpaProvider } from "@/lib/providers/sherpa";
import { TicketmasterProvider } from "@/lib/providers/ticketmaster";
import { configuredResearchToolIds } from "@/lib/research/tools";

const response = (payload: unknown, ok = true, status = 200) => ({ ok, status, json: async () => payload });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("structured research providers", () => {
  it("retrieves Financial Datasets statements without leaking the API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ income_statements: [{ fiscal_period: "Q2", revenue: 10 }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new FinancialDatasetsProvider("financial-secret").financials({ ticker: "aapl", dataset: "income", period: "quarterly", limit: 4 });
    const [requestUrl, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(requestUrl.pathname).toBe("/financials/income-statements");
    expect(requestUrl.searchParams.get("ticker")).toBe("AAPL");
    expect(request.headers).toMatchObject({ "X-API-KEY": "financial-secret" });
    expect(result.sources[0].canonicalUrl).not.toContain("financial-secret");
  });

  it("resolves an SEC ticker and cites direct primary filing documents", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }))
      .mockResolvedValueOnce(response({ filings: { recent: { form: ["10-Q", "8-K"], accessionNumber: ["0000320193-26-000001", "x"], filingDate: ["2026-07-31", "2026-07-01"], reportDate: ["2026-06-30", ""], primaryDocument: ["aapl-20260630.htm", "x.htm"] } } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new SecEdgarProvider("Jarvis Research test@example.com").filings({ ticker: "AAPL", forms: ["10-Q"], limit: 1 });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ type: "filing", publisher: "U.S. Securities and Exchange Commission" });
    expect(result.sources[0].canonicalUrl).toContain("/Archives/edgar/data/320193/000032019326000001/aapl-20260630.htm");
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ "User-Agent": "Jarvis Research test@example.com" });
  });

  it("marks Alpha Vantage's default quote access as delayed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ "Global Quote": { "05. price": "227.16", "10. change percent": "1.25%" } }))
      .mockResolvedValueOnce(response({ markets: [{ market_type: "Equity", region: "United States", current_status: "open" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new AlphaVantageProvider("alpha-secret", 0).quote("aapl");
    expect(result).toMatchObject({ delayed: true, data: { ticker: "AAPL", price: 227.16, changePercent: 1.25, marketOpen: true } });
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("apikey=alpha-secret"))).toBe(true);
    expect(result.sources[0].canonicalUrl).not.toContain("alpha-secret");
  });

  it("preserves a valid quote when optional Alpha Vantage market status is rate-limited", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ "Global Quote": { "05. price": "88.42", "10. change percent": "-0.5%" } }))
      .mockResolvedValueOnce(response({ Information: "Please spread out free API requests more sparingly." }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new AlphaVantageProvider("alpha-secret", 0).quote("mrvl");
    expect(result).toMatchObject({ data: { ticker: "MRVL", price: 88.42, changePercent: -.5, marketOpen: null } });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].excerpt).toContain("market status unavailable");
  });

  it("aggregates OpenWeather's three-hour forecast into dated local days", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([{ name: "Toronto", lat: 43.65, lon: -79.38, country: "CA" }]))
      .mockResolvedValueOnce(response({ city: { id: 6167865, timezone: -14400 }, list: [
        { dt: 1788364800, main: { temp_min: 12, temp_max: 18, humidity: 70 }, weather: [{ description: "rain" }], wind: { speed: 4 }, pop: .8 },
        { dt: 1788375600, main: { temp_min: 14, temp_max: 20, humidity: 60 }, weather: [{ description: "clouds" }], wind: { speed: 5 }, pop: .4 },
      ] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenWeatherProvider("weather-secret").forecast("Toronto", "2026-09-03");
    const data = result.data as { requestedStart: string; days: Array<{ minimumC: number; maximumC: number; precipitationProbability: number }> };
    expect(data.requestedStart).toBe("2026-09-03");
    expect(data.days[0]).toMatchObject({ minimumC: 12, maximumC: 20, precipitationProbability: .8 });
    expect(result.sources[0].canonicalUrl).toBe("https://openweathermap.org/city/6167865");
  });

  it("retrieves date-bounded Ticketmaster events with public event citations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ _embedded: { events: [{ id: "event-1", name: "Concert", url: "https://ticketmaster.example/event-1", dates: { start: { dateTime: "2026-10-01T23:00:00Z" }, status: { code: "onsale" } }, _embedded: { venues: [{ name: "Hall", city: { name: "Toronto" }, timezone: "America/Toronto" }] } }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new TicketmasterProvider("ticket-secret").events("Toronto", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "music");
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("keyword")).toBe("music");
    expect(url.searchParams.get("startDateTime")).toBe("2026-10-01T00:00:00Z");
    expect(result.sources[0]).toMatchObject({ canonicalUrl: "https://ticketmaster.example/event-1", type: "event" });
  });

  it("requests operational and accessibility fields from Google Places", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ places: [{ id: "p1", displayName: { text: "Museum" }, googleMapsUri: "https://maps.google.com/?cid=1", businessStatus: "OPERATIONAL", currentOpeningHours: { openNow: true }, accessibilityOptions: { wheelchairAccessibleEntrance: true }, timeZone: { id: "Europe/Lisbon" }, utcOffsetMinutes: 60 }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GooglePlacesProvider("places-secret").places("Lisbon", ["museum"]);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.headers).toMatchObject({ "X-Goog-Api-Key": "places-secret" });
    expect((request.headers as Record<string, string>)["X-Goog-FieldMask"]).toContain("places.accessibilityOptions");
    expect(result.data[0]).toMatchObject({ businessStatus: "OPERATIONAL", openingHours: { openNow: true }, timeZone: "Europe/Lisbon" });
  });

  it("computes a Google route with a narrow field mask and a key-free citation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ routes: [{ distanceMeters: 1234, duration: "600s" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GoogleRoutesProvider("routes-secret").routes({ origin: "Lisbon airport", destination: "Baixa", mode: "transit", departureTime: "2026-10-01T10:00:00Z" });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ travelMode: "TRANSIT", departureTime: "2026-10-01T10:00:00Z" });
    expect((request.headers as Record<string, string>)["X-Goog-FieldMask"]).toContain("routes.legs.steps.transitDetails");
    expect(result.sources[0].canonicalUrl).not.toContain("routes-secret");
  });

  it("creates Sherpa origin, transit, and destination travel nodes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: { id: "trip", type: "TRIP", attributes: { headline: "Requirements found" } }, included: [{ id: "rule", type: "PROCEDURE", attributes: { category: "VISA" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new SherpaProvider("sherpa-secret").requirements({ passport: "CAN", origin: "CAN", destination: "PRT", transits: ["USA"], departureDate: "2026-10-01", currency: "CAD" });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.data.attributes.traveller.passports).toEqual(["CAN"]);
    expect(body.data.attributes.travelNodes.map((node: { type: string }) => node.type)).toEqual(["ORIGIN", "TRANSIT", "DESTINATION"]);
    expect(body.data.attributes.travelNodes[2]).toMatchObject({ locationCode: "PRT", arrival: { travelMode: "AIR" } });
    expect(request.headers).toMatchObject({ "x-api-key": "sherpa-secret" });
    expect((result.data as { requirements: unknown[] }).requirements).toHaveLength(1);
  });

  it("reports configured capabilities without activating Duffel or commerce", () => {
    const configured = configuredResearchToolIds({ EXA_API_KEY: "x", FINANCIAL_DATASETS_API_KEY: "x", ENABLE_FINANCIAL_DATASETS: "true", SEC_USER_AGENT: "x", ALPHA_VANTAGE_API_KEY: "x", OPENWEATHER_API_KEY: "x", GOOGLE_PLACES_API_KEY: "x", TICKETMASTER_API_KEY: "x", SHERPA_API_KEY: "x", ENABLE_SHERPA: "false" } as unknown as NodeJS.ProcessEnv);
    expect([...configured].sort()).toEqual(["events", "financialDatasets", "marketData", "marketOverview", "places", "routes", "weather", "webSearch"].sort());
    expect(configured.has("travelRequirements")).toBe(false);
    expect(configuredResearchToolIds({ SHERPA_API_KEY: "x", ENABLE_SHERPA: "true" } as unknown as NodeJS.ProcessEnv).has("travelRequirements")).toBe(true);
    expect(configured.has("flightOffers")).toBe(false);
    expect(configured.has("commerceSnapshot")).toBe(false);
  });

  it("does not expose unfunded Financial Datasets credentials by default", () => {
    expect(configuredResearchToolIds({ FINANCIAL_DATASETS_API_KEY: "x" } as unknown as NodeJS.ProcessEnv).has("financialDatasets")).toBe(false);
    expect(configuredResearchToolIds({ FINANCIAL_DATASETS_API_KEY: "x", ENABLE_FINANCIAL_DATASETS: "true" } as unknown as NodeJS.ProcessEnv).has("financialDatasets")).toBe(true);
    expect(configuredResearchToolIds({ SEC_USER_AGENT: "Jarvis test@example.com" } as unknown as NodeJS.ProcessEnv).has("financialDatasets")).toBe(true);
  });
});
