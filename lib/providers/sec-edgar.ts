import type { Source } from "@/lib/contracts";
import type { FilingProvider, ProviderResult } from "@/lib/providers/contracts";
import { expiresAt, fetchProviderJson, providerSignal } from "@/lib/providers/http";

type CompanyTicker = { cik_str: number; ticker: string; title: string };

export class SecEdgarProvider implements FilingProvider {
  private tickerCatalog: Promise<CompanyTicker[]> | undefined;
  constructor(private readonly userAgent = process.env.SEC_USER_AGENT) {}

  private headers() {
    if (!this.userAgent) throw new Error("SEC_USER_AGENT is not configured");
    return { "User-Agent": this.userAgent, Accept: "application/json", "Accept-Encoding": "gzip, deflate" };
  }

  private async companies() {
    this.tickerCatalog ??= fetchProviderJson("https://www.sec.gov/files/company_tickers.json", { headers: this.headers(), signal: providerSignal(undefined) }, "SEC EDGAR")
      .then(payload => Object.values(payload as Record<string, CompanyTicker>))
      .catch(error => { this.tickerCatalog = undefined; throw error; });
    return this.tickerCatalog;
  }

  async filings(input: Parameters<FilingProvider["filings"]>[0]): Promise<ProviderResult<unknown[]>> {
    const ticker = input.ticker.trim().toUpperCase();
    const company = (await this.companies()).find(item => item.ticker.toUpperCase() === ticker);
    if (!company) throw new Error(`SEC EDGAR could not resolve ticker ${ticker}`);
    const cikPadded = String(company.cik_str).padStart(10, "0");
    const submissionsUrl = `https://data.sec.gov/submissions/CIK${cikPadded}.json`;
    const payload = await fetchProviderJson(submissionsUrl, { headers: this.headers(), signal: providerSignal(undefined) }, "SEC EDGAR") as {
      filings?: { recent?: Record<string, unknown[]> };
    };
    const recent = payload.filings?.recent ?? {};
    const forms = new Set((input.forms?.length ? input.forms : ["10-K", "10-Q", "8-K"]).map(value => value.toUpperCase()));
    const limit = Math.min(8, Math.max(1, input.limit ?? 4));
    const rows = (recent.form ?? []).flatMap((form, index) => forms.has(String(form).toUpperCase()) ? [{
      form: String(form),
      accessionNumber: String(recent.accessionNumber?.[index] ?? ""),
      filedAt: String(recent.filingDate?.[index] ?? ""),
      reportPeriod: String(recent.reportDate?.[index] ?? ""),
      primaryDocument: String(recent.primaryDocument?.[index] ?? ""),
    }] : []).slice(0, limit).map(row => {
      const accession = row.accessionNumber.replace(/-/g, "");
      const documentUrl = `https://www.sec.gov/Archives/edgar/data/${company.cik_str}/${accession}/${row.primaryDocument}`;
      return { ...row, company: company.title, ticker, documentUrl };
    });
    const retrievedAt = new Date();
    const sources: Source[] = rows.map((row, index) => ({
      id: `sec-${ticker}-${row.accessionNumber || index}`,
      canonicalUrl: row.documentUrl,
      title: `${company.title} ${row.form} filed ${row.filedAt}`,
      publisher: "U.S. Securities and Exchange Commission",
      publishedAt: row.filedAt ? new Date(`${row.filedAt}T00:00:00.000Z`).toISOString() : null,
      retrievedAt: retrievedAt.toISOString(),
      excerpt: `${row.form}; report period ${row.reportPeriod || "not stated"}; filed ${row.filedAt}; accession ${row.accessionNumber}.`,
      type: "filing",
    }));
    return { data: rows, provider: "sec-edgar", retrievedAt: retrievedAt.toISOString(), expiresAt: expiresAt(retrievedAt, 6 * 60 * 60_000), sources };
  }
}

export const secEdgarProvider = new SecEdgarProvider();
