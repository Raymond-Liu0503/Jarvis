import type { Source } from "@/lib/contracts";
import type { FinancialDataProvider, ProviderResult } from "@/lib/providers/contracts";
import { expiresAt, excerptFromData, fetchProviderJson, providerSignal } from "@/lib/providers/http";

type Dataset = Parameters<FinancialDataProvider["financials"]>[0]["dataset"];
const ENDPOINTS: Record<Dataset, string> = {
  income: "/financials/income-statements",
  "balance-sheet": "/financials/balance-sheets",
  "cash-flow": "/financials/cash-flow-statements",
  metrics: "/financial-metrics",
  "company-facts": "/company/facts",
};

export class FinancialDatasetsProvider implements FinancialDataProvider {
  constructor(private readonly apiKey = process.env.FINANCIAL_DATASETS_API_KEY) {}

  async financials(input: Parameters<FinancialDataProvider["financials"]>[0]): Promise<ProviderResult<unknown>> {
    if (!this.apiKey) throw new Error("FINANCIAL_DATASETS_API_KEY is not configured");
    const ticker = input.ticker.trim().toUpperCase();
    const retrievedAt = new Date();
    const url = new URL(ENDPOINTS[input.dataset], "https://api.financialdatasets.ai");
    url.searchParams.set("ticker", ticker);
    if (input.dataset !== "company-facts") {
      url.searchParams.set("period", input.period ?? "quarterly");
      url.searchParams.set("limit", String(Math.min(8, Math.max(1, input.limit ?? 4))));
    }
    const data = await fetchProviderJson(url, { headers: { "X-API-KEY": this.apiKey }, signal: providerSignal(undefined) }, "Financial Datasets");
    const source: Source = {
      id: `financial-datasets-${ticker}-${input.dataset}`,
      canonicalUrl: url.toString(),
      title: `${ticker} ${input.dataset} data`,
      publisher: "Financial Datasets",
      publishedAt: null,
      retrievedAt: retrievedAt.toISOString(),
      excerpt: excerptFromData(data),
      type: "market",
    };
    return { data, provider: "financial-datasets", retrievedAt: retrievedAt.toISOString(), expiresAt: expiresAt(retrievedAt, 24 * 60 * 60_000), sources: [source] };
  }
}

export const financialDatasetsProvider = new FinancialDatasetsProvider();
