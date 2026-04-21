import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";

import { api, endpoints } from "@/lib/api";
import type { EarningsSeriesResponse, CorporateActionsResponse, InsiderSeriesResponse } from "@/lib/types";
import { echartsBase, COLORS, signalColor } from "@/lib/theme";
import { fmtCap, fmtNum, fmtPct, fmtDay } from "@/lib/format";
import { cn } from "@/lib/cn";

export function SymbolEvents() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = (symbol ?? "").toUpperCase();

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
      {/* EPS Surprise Chart */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          EPS Surprise (Last 8 Quarters)
        </div>
        {earningsLoading ? (
          <div className="h-[200px] animate-pulse rounded bg-bg-3" />
        ) : (
          <EpsSurpriseChart items={earnings?.items ?? []} />
        )}
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

function EpsSurpriseChart({ items }: { items: Array<{ date: string; eps_estimated: number | null; eps_actual: number | null }> }) {
  const data = items
    .filter((e) => e.eps_estimated != null && e.eps_actual != null)
    .slice(0, 8)
    .reverse();

  if (data.length === 0) {
    return <div className="py-8 text-center text-xs text-text-tertiary">No EPS data</div>;
  }

  const option = {
    ...echartsBase,
    tooltip: {
      ...echartsBase.tooltip,
      trigger: "axis",
    },
    legend: {
      ...echartsBase.legend,
      data: ["Estimated", "Actual"],
      top: 0,
    },
    grid: { left: 48, right: 16, top: 28, bottom: 32 },
    xAxis: {
      type: "category",
      data: data.map((d) => fmtDay(d.date).slice(5)),
      axisLine: { lineStyle: { color: COLORS.borderSoft } },
      axisLabel: { color: COLORS.text1, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: COLORS.text1, fontSize: 10 },
      splitLine: { lineStyle: { color: COLORS.borderSoft, type: "dashed" } },
    },
    series: [
      {
        name: "Estimated",
        type: "bar",
        data: data.map((d) => d.eps_estimated),
        itemStyle: { color: COLORS.text2 },
        barWidth: "35%",
      },
      {
        name: "Actual",
        type: "bar",
        data: data.map((d) => d.eps_actual),
        itemStyle: {
          color: (params: { value: number }) =>
            params.value >= (data[params.dataIndex]?.eps_estimated ?? 0) ? COLORS.up : COLORS.down,
        },
        barWidth: "35%",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 200 }} />;
}
