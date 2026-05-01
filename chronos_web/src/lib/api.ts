type QueryValue = string | number | boolean | null | undefined;

function toQuery(params?: Record<string, QueryValue>): string {
  if (!params) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

const API_BASE = "/api/v1";
const AI_BASE = "/api/ai";

export const endpoints = {
  universe: () => `${API_BASE}/data/universe`,
  symbolInventory: (symbol: string) => `${API_BASE}/data/symbols/${symbol}/inventory`,
  symbolSnapshot: (symbol: string) => `${API_BASE}/data/symbols/${symbol}/snapshot`,
  marketSnapshot: () => `${API_BASE}/data/market/snapshot`,
  prices: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/prices`,
  earnings: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/earnings`,
  insider: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/insider`,
  corpActions: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/corporate-actions`,
  secFilings: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/sec-filings`,
  analyst: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/analyst-estimates`,
  dividends: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/dividends`,
  splits: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/splits`,
  valuation: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/valuation`,
  marketCapHistory: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/market-cap-history`,
  staticData: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/static`,
  staticCategories: (symbol: string) => `${API_BASE}/library/symbols/${symbol}/static/categories`,
  macroSeries: () => `${API_BASE}/data/macro/series`,
  macroSeriesById: (seriesId: string) => `${API_BASE}/data/macro/series/${seriesId}`,
  sectorTrends: () => `${API_BASE}/data/sector-trends`,
  sectorSnapshot: (sector: string) => `${API_BASE}/data/sector/${encodeURIComponent(sector)}/snapshot`,
  sectorPerformance: (sector: string) => `${API_BASE}/data/sector-performance?sectors=${encodeURIComponent(sector)}`,
  yieldCurve: () => `${API_BASE}/data/yield-curve`,
  yieldCurveHistory: () => `${API_BASE}/data/yield-curve/history`,
  yieldSpread: () => `${API_BASE}/data/yield-spread`,
  eventsStream: () => `${API_BASE}/data/events/stream`,
  statsOverview: () => `${API_BASE}/stats/overview`,
  tableInventory: () => `${API_BASE}/stats/table-inventory`,
  ingestHealth: () => `${API_BASE}/stats/ingest-health`,
  syncProgress: () => `${API_BASE}/stats/sync-progress`,
  aiChat: () => `${AI_BASE}/chat`,
};

export const api = {
  async get<T>(url: string, options?: { params?: Record<string, QueryValue>; signal?: AbortSignal }): Promise<T> {
    const res = await fetch(`${url}${toQuery(options?.params)}`, { signal: options?.signal });
    if (!res.ok) {
      throw new Error(`GET ${url} failed with ${res.status}`);
    }
    return (await res.json()) as T;
  },
};

interface AIStreamEvent {
  type: string;
  data: unknown;
}

interface StreamAIOptions {
  signal?: AbortSignal;
  onEvent?: (event: AIStreamEvent) => void;
}

export async function streamAI(
  url: string,
  body: unknown,
  options?: StreamAIOptions,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`AI stream failed with ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const flushEvent = (rawEvent: string) => {
    const lines = rawEvent.split("\n");
    let type = "";
    const dataParts: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        type = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataParts.push(line.slice(5).trim());
      }
    }
    if (!type) return;
    const dataRaw = dataParts.join("\n");
    let data: unknown = dataRaw;
    try {
      data = dataRaw ? JSON.parse(dataRaw) : {};
    } catch {
      data = dataRaw;
    }
    options?.onEvent?.({ type, data });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      flushEvent(trimmed);
    }
  }
  if (buffer.trim()) {
    flushEvent(buffer.trim());
  }
}
