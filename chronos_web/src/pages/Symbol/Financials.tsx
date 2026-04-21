import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { StaticSeriesResponse } from "@/lib/types";
import { echartsBase, COLORS } from "@/lib/theme";
import { fmtCap, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";

const CATEGORIES = [
  { key: "income_statement_annual", label: "Income (Annual)" },
  { key: "income_statement_quarter", label: "Income (Quarter)" },
  { key: "balance_sheet_annual", label: "Balance Sheet (Annual)" },
  { key: "balance_sheet_quarter", label: "Balance Sheet (Quarter)" },
  { key: "cash_flow_statement_annual", label: "Cash Flow (Annual)" },
  { key: "cash_flow_statement_quarter", label: "Cash Flow (Quarter)" },
];

type FinancialRow = {
  fiscal_year: number | null;
  fiscal_quarter: number | null;
  raw_payload: Record<string, unknown>;
};

export function SymbolFinancials() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();
  const [selected, setSelected] = useState(CATEGORIES[0]!);

  const period = selected.key.includes("_quarter") ? "quarter" : "annual";
  const category = selected.key.replace(/_(annual|quarter)$/, "");

  const { data, isLoading } = useQuery({
    queryKey: ["static", sym, category, period],
    queryFn: () =>
      api.get<StaticSeriesResponse>(endpoints.staticData(sym), {
        params: { category, period, limit: 8 },
      }),
    enabled: !!sym && !!category,
    staleTime: 5 * 60_000,
  });

  const rows = (data?.items ?? []) as FinancialRow[];
  const latest = rows[0];

  return (
    <div className="flex flex-col gap-4">
      {/* Category selector */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setSelected(c)}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
              selected.key === c.key
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-soft bg-bg-2 text-text-secondary hover:bg-bg-3",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="card flex h-[400px] items-center justify-center">
          <div className="text-sm text-text-tertiary">Loading…</div>
        </div>
      ) : !rows.length ? (
        <div className="card flex h-[400px] items-center justify-center">
          <div className="text-sm text-text-tertiary">No data for this category.</div>
        </div>
      ) : (
        <>
          {/* Key metrics cards */}
          <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <MetricCard
              label="Revenue"
              value={extractValue(latest, "revenue")}
            />
            <MetricCard
              label="Net Income"
              value={extractValue(latest, "netIncome")}
            />
            <MetricCard
              label="EPS"
              value={extractValue(latest, "eps")}
              digits={2}
            />
            <MetricCard
              label="Operating Income"
              value={extractValue(latest, "operatingIncome")}
            />
          </div>

          {/* Waterfall chart for revenue breakdown */}
          <RevenueWaterfall rows={rows} />

          {/* Time series table */}
          <div className="card overflow-auto p-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-soft text-left text-text-tertiary">
                  <th className="px-2 py-1.5">Fiscal Year</th>
                  <th className="px-2 py-1.5">Q</th>
                  <th className="px-2 py-1.5 text-right">Revenue</th>
                  <th className="px-2 py-1.5 text-right">Gross Profit</th>
                  <th className="px-2 py-1.5 text-right">Op Income</th>
                  <th className="px-2 py-1.5 text-right">Net Income</th>
                  <th className="px-2 py-1.5 text-right">EPS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.fiscal_year}-${r.fiscal_quarter}`}
                    className={cn(
                      "border-b border-border-soft/50",
                      i % 2 === 0 ? "bg-bg-2/30" : "",
                    )}
                  >
                    <td className="px-2 py-1.5 font-mono text-text-primary">
                      {r.fiscal_year ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary">
                      {r.fiscal_quarter ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtCap(extractValue(r, "revenue"))}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtCap(extractValue(r, "grossProfit"))}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtCap(extractValue(r, "operatingIncome"))}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtCap(extractValue(r, "netIncome"))}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                      {fmtNum(extractValue(r, "eps"), 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function extractValue(row: FinancialRow | undefined, field: string): number | null {
  if (!row?.raw_payload) return null;
  const v = (row.raw_payload as Record<string, unknown>)[field];
  if (typeof v === "number") return v;
  return null;
}

function MetricCard({
  label,
  value,
  digits = 0,
}: {
  label: string;
  value: number | null;
  digits?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="kpi-num">
        {value === null ? "—" : digits === 0 ? fmtCap(value) : fmtNum(value, digits)}
      </div>
    </div>
  );
}

function RevenueWaterfall({ rows }: { rows: FinancialRow[] }) {
  if (!rows.length || !rows[0]?.raw_payload) return null;

  const payload = rows[0].raw_payload as Record<string, unknown>;
  const revenue = typeof payload.revenue === "number" ? payload.revenue : 0;
  const cogs = typeof payload.costOfGoodsSold === "number" ? payload.costOfGoodsSold : 0;
  const grossProfit = typeof payload.grossProfit === "number" ? payload.grossProfit : 0;
  const opExpenses =
    typeof payload.operatingExpenses === "number" ? payload.operatingExpenses : 0;
  const opIncome =
    typeof payload.operatingIncome === "number" ? payload.operatingIncome : 0;
  const interestExp =
    typeof payload.interestExpense === "number" ? payload.interestExpense : 0;
  const taxExp = typeof payload.incomeTaxExpense === "number" ? payload.incomeTaxExpense : 0;
  const netIncome = typeof payload.netIncome === "number" ? payload.netIncome : 0;

  // Waterfall data: [name, value, isTotal]
  const waterfallData: [string, number, boolean?][] = [
    ["Revenue", revenue],
    ["COGS", -cogs],
    ["Gross Profit", grossProfit, true],
    ["Op Expenses", -opExpenses],
    ["Op Income", opIncome, true],
    ["Interest", -Math.abs(interestExp)],
    ["Tax", -Math.abs(taxExp)],
    ["Net Income", netIncome, true],
  ];

  // Build echarts waterfall
  const xData = waterfallData.map((d) => d[0]);
  const yData: number[] = [];
  let base = 0;
  for (const [, v, isTotal] of waterfallData) {
    if (isTotal) {
      yData.push(v);
      base = v;
    } else {
      yData.push(v);
      base += v;
    }
  }

  const option = {
    ...echartsBase,
    title: {
      text: "Income Statement Waterfall",
      textStyle: { color: COLORS.text1, fontSize: 13 },
      left: 8,
      top: 4,
    },
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0];
        if (!p) return "";
        const v = p.value;
        return `<b>${p.name}</b><br/>${fmtCap(v)}`;
      },
    },
    grid: { left: 80, right: 24, top: 48, bottom: 36 },
    xAxis: {
      type: "category",
      data: xData,
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: { color: COLORS.text1, fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: {
        color: COLORS.text1,
        formatter: (v: number) => fmtCap(v, 0),
      },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: waterfallData.map(([name, v, isTotal], i) => ({
          value: v,
          itemStyle: {
            color: isTotal
              ? COLORS.accent
              : v >= 0
                ? COLORS.up
                : COLORS.down,
          },
        })),
        barWidth: "60%",
      },
    ],
  };

  return (
    <div className="card p-2">
      <ReactECharts option={option} style={{ height: 280 }} />
    </div>
  );
}
