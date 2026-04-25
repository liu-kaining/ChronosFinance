import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { EarningsSeriesResponse, CorporateActionsResponse, InsiderSeriesResponse } from "@/lib/types";
import { echartsBase, COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";

export function SymbolEvents() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();
  const [epsWindow, setEpsWindow] = useState<8 | 12 | 16>(8);

  const { data: earnings, isLoading: earningsLoading } = useQuery({
    queryKey: ["earnings", sym],
    queryFn: () => api.get<EarningsSeriesResponse>(endpoints.earnings(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: actions } = useQuery({
    queryKey: ["corp-actions", sym],
    queryFn: () => api.get<CorporateActionsResponse>(endpoints.corpActions(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  const { data: insider } = useQuery({
    queryKey: ["insider", sym],
    queryFn: () => api.get<InsiderSeriesResponse>(endpoints.insider(sym)),
    enabled: !!sym,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="card grid grid-cols-3 gap-3 p-3 text-center">
        <div>
          <div className="text-2xs text-text-tertiary">Earnings Rows</div>
          <div className="kpi-num">{(earnings?.items ?? []).length}</div>
        </div>
        <div>
          <div className="text-2xs text-text-tertiary">Insider Rows</div>
          <div className="kpi-num">{(insider?.items ?? []).length}</div>
        </div>
        <div>
          <div className="text-2xs text-text-tertiary">Corp Actions</div>
          <div className="kpi-num">{(actions?.items ?? []).length}</div>
        </div>
      </div>

      {/* EPS Surprise Chart */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          <span>EPS Surprise (Last {epsWindow} Quarters)</span>
          <div className="flex items-center gap-1 normal-case tracking-normal">
            {[8, 12, 16].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setEpsWindow(w as 8 | 12 | 16)}
                className={cn(
                  "rounded border px-2 py-0.5 text-2xs",
                  epsWindow === w
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border-soft text-text-tertiary",
                )}
              >
                {w}Q
              </button>
            ))}
          </div>
        </div>
        {earningsLoading ? (
          <div className="h-[200px] animate-pulse rounded bg-bg-3" />
        ) : (
          <EpsSurpriseChart items={earnings?.items ?? []} window={epsWindow} />
        )}
      </div>

      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          EPS Surprise Heatmap (Quarter Matrix)
        </div>
        <EpsSurpriseHeatmap items={earnings?.items ?? []} window={epsWindow} />
      </div>

      {/* Earnings table */}
      <div className="card overflow-auto p-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-soft text-left text-text-tertiary">
              <th className="px-2 py-1.5">Date</th>
              <th className="px-2 py-1.5">Fiscal Period</th>
              <th className="px-2 py-1.5 text-right">EPS Est</th>
              <th className="px-2 py-1.5 text-right">EPS Actual</th>
              <th className="px-2 py-1.5 text-right">Surprise</th>
              <th className="px-2 py-1.5 text-right">Rev Est</th>
              <th className="px-2 py-1.5 text-right">Rev Actual</th>
            </tr>
          </thead>
          <tbody>
            {(earnings?.items ?? []).slice(0, 12).map((e, i) => {
              const epsSurprise =
                e.eps_estimated && e.eps_actual
                  ? ((e.eps_actual - e.eps_estimated) / Math.abs(e.eps_estimated)) * 100
                  : null;
              return (
                <tr
                  key={`${e.date}-${i}`}
                  className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
                >
                  <td className="px-2 py-1.5 font-mono text-text-primary">{fmtDay(e.date)}</td>
                  <td className="px-2 py-1.5 text-text-secondary">{e.fiscal_period_end ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {fmtNum(e.eps_estimated, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-primary">
                    {fmtNum(e.eps_actual, 2)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right font-mono"
                    style={{ color: signalColor(epsSurprise ? epsSurprise / 100 : null) }}
                  >
                    {epsSurprise !== null ? `${epsSurprise >= 0 ? "+" : ""}${epsSurprise.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                    {fmtCap(e.revenue_estimated)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-text-primary">
                    {fmtCap(e.revenue_actual)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Corporate Actions */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Corporate Actions
        </div>
        <div className="flex flex-wrap gap-2">
          {(actions?.items ?? []).slice(0, 10).map((a, i) => (
            <div
              key={`${a.action_date}-${i}`}
              className="chip flex items-center gap-1.5"
            >
              <span
                className={cn(
                  "rounded px-1 py-0.5 text-2xs font-medium",
                  a.action_type === "dividend"
                    ? "bg-up-soft text-up"
                    : a.action_type === "split"
                      ? "bg-purple/15 text-purple"
                      : "bg-bg-3 text-text-secondary",
                )}
              >
                {a.action_type}
              </span>
              <span className="font-mono text-2xs text-text-secondary">
                {fmtDay(a.action_date)}
              </span>
            </div>
          ))}
          {(!actions?.items || actions.items.length === 0) && (
            <span className="text-xs text-text-tertiary">No recent actions</span>
          )}
        </div>
      </div>

      {/* Insider trades */}
      <div className="card overflow-auto p-2">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Insider Trades
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-soft text-left text-text-tertiary">
              <th className="px-2 py-1.5">Filing Date</th>
              <th className="px-2 py-1.5">Insider</th>
              <th className="px-2 py-1.5">Type</th>
              <th className="px-2 py-1.5 text-right">Shares</th>
              <th className="px-2 py-1.5 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {(insider?.items ?? []).slice(0, 15).map((ins, i) => (
              <tr
                key={`${ins.filing_date}-${i}`}
                className={cn("border-b border-border-soft/50", i % 2 === 0 ? "bg-bg-2/30" : "")}
              >
                <td className="px-2 py-1.5 font-mono text-text-secondary">
                  {fmtDay(ins.filing_date)}
                </td>
                <td className="max-w-[200px] truncate px-2 py-1.5 text-text-primary">
                  {ins.reporting_name ?? "—"}
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={cn(
                      "rounded px-1 py-0.5 text-2xs",
                      ins.transaction_type?.toLowerCase().includes("buy")
                        ? "bg-up-soft text-up"
                        : ins.transaction_type?.toLowerCase().includes("sell")
                          ? "bg-down-soft text-down"
                          : "bg-bg-3 text-text-secondary",
                    )}
                  >
                    {ins.transaction_type ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                  {fmtCap(ins.securities_transacted, 0)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                  {fmtNum(ins.price, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!insider?.items || insider.items.length === 0) && (
          <div className="py-4 text-center text-xs text-text-tertiary">No insider trades</div>
        )}
      </div>
    </div>
  );
}

function EpsSurpriseChart({
  items,
  window,
}: {
  items: Array<{ date: string; eps_estimated: number | null; eps_actual: number | null }>;
  window: number;
}) {
  const data = items
    .filter((e) => e.eps_estimated != null && e.eps_actual != null)
    .slice(0, window)
    .reverse();

  if (data.length === 0) {
    return <div className="py-8 text-center text-xs text-text-tertiary">No EPS data</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: ["Estimated", "Actual"],
      top: 0,
      textStyle: { color: COLORS.text },
    },
    grid: { left: 48, right: 16, top: 28, bottom: 32 },
    xAxis: {
      type: "category",
      data: data.map((d) => fmtDay(d.date).slice(5)),
      axisLine: { lineStyle: { color: COLORS.grid } },
      axisLabel: { color: COLORS.text, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: COLORS.text, fontSize: 10 },
      splitLine: { lineStyle: { color: COLORS.grid, type: "dashed" } },
    },
    series: [
      {
        name: "Estimated",
        type: "bar",
        data: data.map((d) => d.eps_estimated),
        itemStyle: { color: "#6b7280" },
        barWidth: "35%",
      },
      {
        name: "Actual",
        type: "bar",
        data: data.map((d) => d.eps_actual),
        itemStyle: {
          color: (params: { value: number; dataIndex: number }) =>
            params.value >= (data[params.dataIndex]?.eps_estimated ?? 0) ? COLORS.up : COLORS.down,
        },
        barWidth: "35%",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 200 }} />;
}

function EpsSurpriseHeatmap({
  items,
  window,
}: {
  items: Array<{ date: string; eps_estimated: number | null; eps_actual: number | null }>;
  window: number;
}) {
  const enriched = items
    .filter((e) => e.eps_estimated != null && e.eps_actual != null && e.eps_estimated !== 0)
    .slice(0, window)
    .map((e) => {
      const dt = new Date(e.date);
      const year = Number.isNaN(dt.getTime()) ? "N/A" : String(dt.getUTCFullYear());
      const q = Number.isNaN(dt.getTime()) ? "?" : `Q${Math.floor(dt.getUTCMonth() / 3) + 1}`;
      const surprise = ((e.eps_actual! - e.eps_estimated!) / Math.abs(e.eps_estimated!)) * 100;
      return { year, quarter: q, surprise };
    })
    .sort((a, b) => a.year.localeCompare(b.year));

  if (enriched.length === 0) {
    return <div className="py-8 text-center text-xs text-text-tertiary">No EPS surprise data</div>;
  }

  const years = Array.from(new Set(enriched.map((x) => x.year)));
  const quarters = ["Q1", "Q2", "Q3", "Q4"];
  const matrix = enriched
    .map((x) => [years.indexOf(x.year), quarters.indexOf(x.quarter), Number(x.surprise.toFixed(2))] as [number, number, number])
    .filter((row) => row[0] >= 0 && row[1] >= 0);
  const maxAbs = Math.max(...matrix.map((m) => Math.abs(m[2])), 5);

  const option = {
    ...echartsBase,
    tooltip: {
      position: "top",
      formatter: (p: { data: [number, number, number] }) => {
        const [x, y, v] = p.data;
        return `${years[x]} ${quarters[y]}<br/>Surprise: ${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
      },
    },
    grid: { left: 52, right: 18, top: 8, bottom: 28 },
    xAxis: {
      type: "category",
      data: years,
      axisLabel: { color: COLORS.text, fontSize: 10 },
      axisLine: { lineStyle: { color: COLORS.grid } },
    },
    yAxis: {
      type: "category",
      data: quarters,
      axisLabel: { color: COLORS.text, fontSize: 10 },
      axisLine: { lineStyle: { color: COLORS.grid } },
    },
    visualMap: {
      min: -maxAbs,
      max: maxAbs,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { color: COLORS.text },
      inRange: { color: ["#ef4444", "#111827", "#22c55e"] },
    },
    series: [
      {
        type: "heatmap",
        data: matrix,
        label: {
          show: true,
          color: "#e5e7eb",
          formatter: (p: { data: [number, number, number] }) => `${p.data[2]}%`,
        },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.35)" } },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 220 }} />;
}
