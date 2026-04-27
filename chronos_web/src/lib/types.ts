export interface UniverseItem {
  symbol: string;
  company_name?: string;
  market_cap?: number;
  sector?: string;
  industry?: string;
  exchange?: string;
  [key: string]: unknown;
}

export interface UniversePage {
  items: UniverseItem[];
  total_matching: number;
  limit: number;
  offset: number;
  [key: string]: unknown;
}

export interface DailyPrice {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  [key: string]: unknown;
}

export interface PricesSeriesResponse {
  items: DailyPrice[];
  rows: number;
  [key: string]: unknown;
}

export interface SymbolInventory {
  symbol: string;
  universe?: UniverseItem;
  [key: string]: unknown;
}

export interface StaticCategoryInfo {
  data_category: string;
  period: string;
  fiscal_year_min?: number;
  fiscal_year_max?: number;
  rows: number;
  [key: string]: unknown;
}

export interface StaticCategoriesResponse {
  categories: StaticCategoryInfo[];
  [key: string]: unknown;
}

export interface StaticSeriesResponse {
  items: Record<string, unknown>[];
  rows: number;
  [key: string]: unknown;
}

export interface EarningsSeriesResponse {
  items: Record<string, unknown>[];
  rows: number;
  [key: string]: unknown;
}

export interface CorporateActionsResponse {
  items: Record<string, unknown>[];
  rows: number;
  [key: string]: unknown;
}

export interface InsiderSeriesResponse {
  items: Record<string, unknown>[];
  rows: number;
  [key: string]: unknown;
}

export interface AnalystEstimatesResponse {
  items: Record<string, unknown>[];
  rows: number;
  [key: string]: unknown;
}

export interface DividendHistoryResponse {
  symbol: string;
  rows: number;
  items: Array<{
    date: string;
    dividend?: number | null;
    adjusted_dividend?: number | null;
    record_date?: string | null;
    payment_date?: string | null;
    declaration_date?: string | null;
  }>;
}

export interface SplitHistoryResponse {
  symbol: string;
  rows: number;
  items: Array<{
    date: string;
    numerator?: number | null;
    denominator?: number | null;
    ratio_str?: string | null;
  }>;
}

export interface ValuationResponse {
  symbol: string;
  latest_dcf?: number | null;
  latest_price?: number | null;
  upside_pct?: number | null;
  rows: number;
  items: Array<{
    date: string;
    dcf?: number | null;
    stock_price?: number | null;
  }>;
}

export interface MarketCapHistoryResponse {
  symbol: string;
  rows: number;
  items: Array<{
    date: string;
    market_cap?: number | null;
  }>;
}

export interface SecFilingsListResponse {
  items: Record<string, unknown>[];
  rows: number;
  [key: string]: unknown;
}

export interface MacroSeriesListResponse {
  items: Array<{ series_id: string; [key: string]: unknown }>;
  rows: number;
  [key: string]: unknown;
}

export interface MacroSeriesDataResponse {
  items: Record<string, unknown>[];
  rows: number;
  [key: string]: unknown;
}

export interface SyncProgressResponse {
  active_symbols: number;
  inactive_symbols: number;
  active_with_income_synced: number;
  active_with_balance_synced: number;
  active_with_cashflow_synced: number;
  active_with_ratios_synced: number;
  active_with_metrics_synced: number;
  active_with_scores_synced: number;
  active_with_ev_synced: number;
  active_with_compensation_synced: number;
  active_with_segments_synced: number;
  active_with_peers_synced: number;
  active_with_prices_synced: number;
  active_with_actions_synced: number;
  active_with_earnings_synced: number;
  active_with_insider_synced: number;
  active_with_estimates_synced: number;
  active_with_filings_synced: number;
  active_with_float_synced: number;
  active_with_market_cap_synced: number;
  active_with_dcf_synced: number;
}

export interface StatsOverview {
  universe: {
    total: number;
    active: number;
    inactive: number;
  };
  tables: {
    static_financials: number;
    daily_prices: number;
    corporate_actions: number;
    earnings_calendar: number;
    insider_trades: number;
    analyst_estimates: number;
    sec_files: number;
    macro_economics: number;
  };
}

export interface TableInventoryItem {
  table: string;
  est_rows: number;
  name_zh: string;
  group_zh: string;
  exposed_in_ui: boolean;
  note?: string | null;
}

export interface TableInventoryResponse {
  items: TableInventoryItem[];
  diagnostics_zh: string;
}

export interface MoverRow {
  symbol: string;
  company_name?: string;
  date?: string;
  close?: number;
  prev_close?: number;
  change_pct?: number;
  volume?: number;
}

export interface MarketSnapshotResponse {
  as_of_date?: string;
  active_symbols: number;
  sectors: Array<{
    sector: string;
    symbols: number;
    market_cap_total?: number;
    avg_change_pct?: number;
  }>;
  top_gainers: MoverRow[];
  top_losers: MoverRow[];
  most_active: MoverRow[];
}

export interface SectorTrendsResponse {
  as_of_date?: string | null;
  trends: Array<{
    sector: string;
    change_1d?: number | null;
    change_1w?: number | null;
    change_1m?: number | null;
    avg_pe?: number | null;
  }>;
}

export interface SectorSnapshotResponse {
  sector: string;
  as_of_date?: string | null;
  avg_change_1d?: number | null;
  avg_change_1m?: number | null;
  avg_pe?: number | null;
  total_market_cap?: number | null;
  constituents: Array<{
    symbol: string;
    company_name?: string | null;
    market_cap?: number | null;
    change_pct?: number | null;
    close?: number | null;
    volume?: number | null;
  }>;
}

export interface SectorPerformanceResponse {
  sectors: string[];
  metric: string;
  series: Array<{
    sector: string;
    metric: string;
    rows: number;
    date_min?: string | null;
    date_max?: string | null;
    items: Array<{ date: string; value?: number | null }>;
  }>;
}

export interface SymbolSnapshotResponse {
  symbol: string;
  universe?: UniverseItem;
  latest_price?: {
    date?: string;
    close?: number;
    prev_close?: number;
    change_pct?: number;
    volume?: number;
    pe_ratio?: number;
    fifty_two_week_low?: number;
    fifty_two_week_high?: number;
  };
  latest_earnings?: {
    date?: string;
    eps_estimated?: number;
    eps_actual?: number;
    revenue_estimated?: number;
    revenue_actual?: number;
  };
  latest_insider?: {
    filing_date?: string;
    transaction_date?: string;
    reporting_name?: string;
    transaction_type?: string;
    securities_transacted?: number;
  };
  insider_rows_90d: number;
  sec_by_form: Array<{ form_type: string; rows: number; latest_filing_date?: string }>;
  analyst_by_kind: Array<{ name: string; rows: number }>;
  synced_flags_true: number;
  synced_flags_total: number;
}

export interface EventsStreamResponse {
  earnings: Array<{
    symbol: string;
    company_name?: string;
    date: string;
    eps_estimated?: number;
    eps_actual?: number;
    revenue_estimated?: number;
    revenue_actual?: number;
  }>;
  insider: Array<{
    symbol: string;
    company_name?: string;
    filing_date?: string;
    transaction_date?: string;
    reporting_name?: string;
    transaction_type?: string;
    securities_transacted?: number;
  }>;
  sec_filings: Array<{
    symbol: string;
    company_name?: string;
    form_type: string;
    filing_date?: string;
    fiscal_year?: number;
    fiscal_period?: string;
  }>;
}

export interface IngestHealthResponse {
  running: number;
  failed: number;
  ok: number;
  skipped: number;
}
