import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api, endpoints } from "@/lib/api";
import type { SymbolInventory, PricesSeriesResponse, StaticSeriesResponse, EarningsSeriesResponse } from "@/lib/types";
import { cn } from "@/lib/cn";

type DataSource = "inventory" | "prices" | "earnings" | "income" | "balance" | "cashflow";

const SOURCES: { key: DataSource; label: string }[] = [
  { key: "inventory", label: "Inventory" },
  { key: "prices", label: "Prices (Last 30)" },
  { key: "earnings", label: "Earnings" },
  { key: "income", label: "Income Statement" },
  { key: "balance", label: "Balance Sheet" },
  { key: "cashflow", label: "Cash Flow" },
];

export function SymbolRaw() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();
  const [source, setSource] = useState<DataSource>("inventory");

  const { data: inventory } = useQuery({
    queryKey: ["inventory", sym],
    queryFn: () => api.get<SymbolInventory>(endpoints.symbolInventory(sym)),
    enabled: !!sym,
    staleTime: 60_000,
  });

  const { data: prices } = useQuery({
    queryKey: ["prices-raw", sym],
    queryFn: () =>
      api.get<PricesSeriesResponse>(endpoints.prices(sym), { params: { limit: 30, order: "desc" } }),
    enabled: !!sym && source === "prices",
    staleTime: 60_000,
  });

  const { data: earnings } = useQuery({
    queryKey: ["earnings-raw", sym],
    queryFn: () => api.get<EarningsSeriesResponse>(endpoints.earnings(sym)),
    enabled: !!sym && source === "earnings",
    staleTime: 5 * 60_000,
  });

  const { data: income } = useQuery({
    queryKey: ["income-raw", sym],
    queryFn: () =>
      api.get<StaticSeriesResponse>(endpoints.staticData(sym), {
        params: { category: "income_statement_annual", period: "annual", limit: 5 },
      }),
    enabled: !!sym && source === "income",
    staleTime: 5 * 60_000,
  });

  const { data: balance } = useQuery({
    queryKey: ["balance-raw", sym],
    queryFn: () =>
      api.get<StaticSeriesResponse>(endpoints.staticData(sym), {
        params: { category: "balance_sheet_annual", period: "annual", limit: 5 },
      }),
    enabled: !!sym && source === "balance",
    staleTime: 5 * 60_000,
  });

  const { data: cashflow } = useQuery({
    queryKey: ["cashflow-raw", sym],
    queryFn: () =>
      api.get<StaticSeriesResponse>(endpoints.staticData(sym), {
        params: { category: "cash_flow_statement_annual", period: "annual", limit: 5 },
      }),
    enabled: !!sym && source === "cashflow",
    staleTime: 5 * 60_000,
  });

  let rawData: unknown = null;
  switch (source) {
    case "inventory":
      rawData = inventory;
      break;
    case "prices":
      rawData = prices;
      break;
    case "earnings":
      rawData = earnings;
      break;
    case "income":
      rawData = income;
      break;
    case "balance":
      rawData = balance;
      break;
    case "cashflow":
      rawData = cashflow;
      break;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Source selector */}
      <div className="flex flex-wrap gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSource(s.key)}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
              source === s.key
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-soft bg-bg-2 text-text-secondary hover:bg-bg-3",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* JSON viewer */}
      <div className="card overflow-auto p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-text-tertiary">
            {SOURCES.find((s) => s.key === source)?.label}
          </span>
          <span className="text-text-tertiary">
            {rawData ? `${JSON.stringify(rawData).length.toLocaleString()} bytes` : "—"}
          </span>
        </div>
        <pre className="overflow-auto rounded-md bg-bg-2 p-3 font-mono text-2xs leading-relaxed text-text-secondary">
          {rawData ? JSON.stringify(rawData, null, 2) : "Loading…"}
        </pre>
      </div>
    </div>
  );
}
