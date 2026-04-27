type UnknownRecord = Record<string, unknown>;

export type FinancialMetricKey =
  | "revenue"
  | "costOfRevenue"
  | "grossProfit"
  | "operatingExpenses"
  | "operatingIncome"
  | "netIncome"
  | "eps"
  | "cashAndEquivalents"
  | "currentAssets"
  | "currentLiabilities"
  | "totalAssets"
  | "totalLiabilities"
  | "totalDebt"
  | "totalEquity"
  | "operatingCashFlow"
  | "capitalExpenditure"
  | "freeCashFlow"
  | "dividendsPaid";

export interface FinancialStatementRow {
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  rawPayload: UnknownRecord;
}

const FIELD_ALIASES: Record<FinancialMetricKey, string[]> = {
  revenue: ["revenue", "totalRevenue"],
  costOfRevenue: ["costOfRevenue", "costOfGoodsSold"],
  grossProfit: ["grossProfit"],
  operatingExpenses: ["operatingExpenses", "totalOperatingExpenses"],
  operatingIncome: ["operatingIncome", "operatingIncomeLoss"],
  netIncome: ["netIncome"],
  eps: ["eps", "epsDiluted", "epsbasic", "epsBasic"],
  cashAndEquivalents: ["cashAndCashEquivalents", "cashAndShortTermInvestments"],
  currentAssets: ["totalCurrentAssets", "currentAssets"],
  currentLiabilities: ["totalCurrentLiabilities", "currentLiabilities"],
  totalAssets: ["totalAssets"],
  totalLiabilities: ["totalLiabilities"],
  totalDebt: ["totalDebt", "shortTermDebt", "longTermDebt"],
  totalEquity: ["totalStockholdersEquity", "totalEquity", "shareholdersEquity"],
  operatingCashFlow: ["operatingCashFlow", "netCashProvidedByOperatingActivities"],
  capitalExpenditure: ["capitalExpenditure", "capitalExpenditures"],
  freeCashFlow: ["freeCashFlow"],
  dividendsPaid: ["dividendsPaid", "commonDividendsPaid"],
};

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickNumeric(payload: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = toNumber(payload[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function getFinancialMetric(row: FinancialStatementRow | undefined, metric: FinancialMetricKey): number | null {
  if (!row?.rawPayload) return null;
  return pickNumeric(row.rawPayload, FIELD_ALIASES[metric]);
}

export function toFinancialStatementRows(
  items: Array<{ fiscal_year?: unknown; fiscal_quarter?: unknown; raw_payload?: UnknownRecord }>,
): FinancialStatementRow[] {
  return items.map((item) => ({
    fiscalYear: toNumber(item.fiscal_year),
    fiscalQuarter: toNumber(item.fiscal_quarter),
    rawPayload: item.raw_payload ?? {},
  }));
}

export function periodTag(row: FinancialStatementRow | undefined): string {
  if (!row) return "—";
  return row.fiscalQuarter ? `${row.fiscalYear ?? "—"}Q${row.fiscalQuarter}` : `${row.fiscalYear ?? "—"}年`;
}

export function rowIdentity(row: FinancialStatementRow | undefined): string {
  if (!row) return "";
  return `${row.fiscalYear ?? "NA"}-${row.fiscalQuarter ?? "NA"}`;
}
