import type { Source } from "@/lib/contracts";
import type { MarketDataProvider, MarketOverviewProvider, ProviderResult } from "@/lib/providers/contracts";
import { expiresAt, fetchProviderJson, numberFrom, providerSignal } from "@/lib/providers/http";

type GlobalQuote = Record<string, string>;
type MarketStatus = { market_type?: string; region?: string; primary_exchanges?: string; local_open?: string; local_close?: string; current_status?: string; notes?: string };

function publicApiUrl(functionName: string, params: Record<string, string> = {}) {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", functionName);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export class AlphaVantageProvider implements MarketDataProvider, MarketOverviewProvider {
  private requestTail: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  constructor(private readonly apiKey = process.env.ALPHA_VANTAGE_API_KEY, private readonly minimumIntervalMs = 1_100) {}

  private request(functionName: string, params: Record<string, string> = {}) {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("ALPHA_VANTAGE_API_KEY is not configured");
    const execute = async () => {
      const waitMs = Math.max(0, this.lastRequestAt + this.minimumIntervalMs - Date.now());
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      const url = new URL(publicApiUrl(functionName, params));
      url.searchParams.set("apikey", apiKey);
      try { return await fetchProviderJson(url, { signal: providerSignal(undefined) }, "Alpha Vantage"); }
      finally { this.lastRequestAt = Date.now(); }
    };
    const result = this.requestTail.then(execute, execute);
    this.requestTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async quote(tickerInput: string): Promise<ProviderResult<{ ticker: string; price: number; currency: string; changePercent: number; marketOpen: boolean | null }>> {
    const ticker = tickerInput.trim().toUpperCase();
    const quotePayload = await this.request("GLOBAL_QUOTE", { symbol: ticker }) as { "Global Quote"?: GlobalQuote };
    const statusPayload = await this.request("MARKET_STATUS").catch(() => undefined) as { markets?: MarketStatus[] } | undefined;
    const quote = quotePayload["Global Quote"] ?? {};
    if (!quote["05. price"]) throw new Error(`Alpha Vantage returned no quote for ${ticker}`);
    const market = (statusPayload?.markets ?? []).find(item => item.region === "United States" && item.market_type === "Equity") ?? statusPayload?.markets?.[0];
    const data = {
      ticker,
      price: numberFrom(quote["05. price"]),
      currency: "USD",
      changePercent: numberFrom(quote["10. change percent"]?.replace("%", "")),
      marketOpen: market?.current_status ? market.current_status.toLowerCase() === "open" : null,
    };
    const retrievedAt = new Date();
    const source: Source = {
      id: `alpha-vantage-quote-${ticker}`,
      canonicalUrl: publicApiUrl("GLOBAL_QUOTE", { symbol: ticker }),
      title: `${ticker} market quote`, publisher: "Alpha Vantage", publishedAt: null,
      retrievedAt: retrievedAt.toISOString(),
      excerpt: `${ticker}: ${data.price} ${data.currency}; change ${data.changePercent}%; market ${data.marketOpen === null ? "status unavailable" : data.marketOpen ? "open" : "closed"}. Default API access may be delayed or end-of-day.`,
      type: "market",
    };
    return { data, provider: "alpha-vantage", retrievedAt: retrievedAt.toISOString(), expiresAt: expiresAt(retrievedAt, 15 * 60_000), delayed: true, sources: [source] };
  }

  async overview(): Promise<ProviderResult<{ indices: unknown[]; gainers: unknown[]; losers: unknown[]; active: unknown[] }>> {
    const movers = await this.request("TOP_GAINERS_LOSERS") as Record<string, unknown>;
    const status = await this.request("MARKET_STATUS").catch(() => ({ markets: [] })) as { markets?: MarketStatus[] };
    const take = (value: unknown) => Array.isArray(value) ? value.slice(0, 10) : [];
    const data = { indices: (status.markets ?? []).slice(0, 12), gainers: take(movers.top_gainers), losers: take(movers.top_losers), active: take(movers.most_actively_traded) };
    const retrievedAt = new Date();
    const source: Source = {
      id: "alpha-vantage-market-overview", canonicalUrl: publicApiUrl("TOP_GAINERS_LOSERS"), title: "Market movers and trading status",
      publisher: "Alpha Vantage", publishedAt: null, retrievedAt: retrievedAt.toISOString(),
      excerpt: `Top gainers, losers, and active securities; ${data.indices.length} market-status records. Default API access may be delayed or end-of-day.`, type: "market",
    };
    return { data, provider: "alpha-vantage", retrievedAt: retrievedAt.toISOString(), expiresAt: expiresAt(retrievedAt, 60 * 60_000), delayed: true, sources: [source] };
  }
}

export const alphaVantageProvider = new AlphaVantageProvider();
