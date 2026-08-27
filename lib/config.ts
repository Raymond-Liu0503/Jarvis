export const LIMITS = { stocks: 20, travel: 10, shopping: 20 } as const;
export const CACHE_TTL_MS = {
  marketOpen: 5 * 60_000, marketClosed: 30 * 60_000, movers: 30 * 60_000, earnings: 30 * 60_000,
  weather: 60 * 60_000, events: 6 * 60 * 60_000, places: 6 * 60 * 60_000, shopping: 6 * 60 * 60_000,
  flightsMax: 30 * 60_000,
} as const;
export const isExpired = (expiresAt: string, now = Date.now()) => Date.parse(expiresAt) <= now;
export const priceChangePercent = (current: number, previous?: number | null) =>
  previous && previous > 0 ? ((current - previous) / previous) * 100 : null;
