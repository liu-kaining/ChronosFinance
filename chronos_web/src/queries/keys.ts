/** Unified queryKey factory for React Query. */

export const queryKeys = {
  // Universe
  universe: (params?: { active_only?: boolean; sector?: string; symbol_prefix?: string; limit?: number; offset?: number }) =>
    ["universe", params] as const,

  // Symbol
  symbolInventory: (symbol: string) => ["symbolInventory", symbol] as const,
  symbolSnapshot: (symbol: string) => ["symbolSnapshot", symbol] as const,
  prices: (symbol: string, limit?: number) => ["prices", symbol, limit] as const,
  earnings: (symbol: string, limit?: number) => ["earnings", symbol, limit] as const,
  insider: (symbol: string, limit?: number) => ["insider", symbol, limit] as const,
  corpActions: (symbol: string, limit?: number) => ["corpActions", symbol, limit] as const,
  secFilings: (symbol: string, limit?: number) => ["secFilings", symbol, limit] as const,
  analyst: (symbol: string, limit?: number) => ["analyst", symbol, limit] as const,
  dividends: (symbol: string, limit?: number) => ["dividends", symbol, limit] as const,
  splits: (symbol: string, limit?: number) => ["splits", symbol, limit] as const,
  valuation: (symbol: string) => ["valuation", symbol] as const,
  marketCapHistory: (symbol: string, limit?: number) => ["marketCapHistory", symbol, limit] as const,
  staticData: (symbol: string, category?: string, period?: string) => ["staticData", symbol, category, period] as const,
  staticCategories: (symbol: string) => ["staticCategories", symbol] as const,

  // Market
  marketSnapshot: (limit?: number) => ["marketSnapshot", limit] as const,
  sectorTrends: () => ["sectorTrends"] as const,
  sectorSnapshot: (sector: string) => ["sectorSnapshot", sector] as const,
  sectorPerformance: (sector: string, metric?: string, days?: number) => ["sectorPerformance", sector, metric, days] as const,
  eventsStream: (limit?: number) => ["eventsStream", limit] as const,

  // Macro
  macroSeries: () => ["macroSeries"] as const,
  macroSeriesById: (seriesId: string, limit?: number) => ["macroSeriesById", seriesId, limit] as const,

  // Yield curve
  yieldCurve: () => ["yieldCurve"] as const,
  yieldCurveHistory: (date?: string) => ["yieldCurveHistory", date] as const,
  yieldSpread: (tenor1?: string, tenor2?: string, days?: number) => ["yieldSpread", tenor1, tenor2, days] as const,

  // Stats
  statsOverview: () => ["statsOverview"] as const,
  tableInventory: () => ["tableInventory"] as const,
  syncProgress: () => ["syncProgress"] as const,
  ingestHealth: () => ["ingestHealth"] as const,
} as const;
