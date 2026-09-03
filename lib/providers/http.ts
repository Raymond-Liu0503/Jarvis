export function providerSignal(signal: AbortSignal | undefined, timeoutMs = 12_000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function fetchProviderJson(url: string | URL, init: RequestInit, provider: string) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${provider} request failed (${response.status})`);
  const payload = await response.json() as unknown;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const providerError = record.error ?? record["Error Message"] ?? record.Note ?? record.Information;
    if (typeof providerError === "string" && providerError.trim()) throw new Error(`${provider} returned an error: ${providerError.slice(0, 300)}`);
  }
  return payload;
}

export function expiresAt(retrievedAt: Date, ttlMs: number) {
  return new Date(retrievedAt.getTime() + ttlMs).toISOString();
}

export function numberFrom(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function excerptFromData(value: unknown, limit = 800) {
  try { return JSON.stringify(value).slice(0, limit); }
  catch { return String(value).slice(0, limit); }
}
